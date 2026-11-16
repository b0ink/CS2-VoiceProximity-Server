const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { encode, decode } = require('@msgpack/msgpack');
const {
  makeServer,
  Socket,
  token,
  plugin,
  client,
  roster,
  settle,
} = require('./helpers/server.cjs');

const steamId = '76561198000000001';
const roomCode = '192.0.2.10:27015';
const joinData = () => ({ token: token(steamId), steamId, roomCode, isMuted: false });

async function joinedClient(state) {
  const publisher = await state.connect(plugin('publisher', 'owner'));
  await publisher.invoke('player-positions', 'proximity-chat', roster(steamId, true));
  const socket = await state.connect(client('client', steamId));
  let reply;
  await socket.invoke('join-room', joinData(), (value) => {
    reply = value;
  });
  assert.equal(reply.success, true);
  return { publisher, socket };
}

test('original anonymous no-ACK attack does not terminate Node', () => {
  const helper = require.resolve('./helpers/server.cjs');
  const script = `
    const assert = require('node:assert/strict');
    const { makeServer, Socket, client, settle } = require(${JSON.stringify(helper)});
    (async () => {
      const state = makeServer();
      const anonymous = await state.connect(new Socket('anonymous'));
      anonymous.receive('join-room', {});
      const authenticated = await state.connect(client('authenticated', '${steamId}'));
      authenticated.receive('join-room', null);
      authenticated.receive('join-room', {});
      authenticated.receive('join-room', null, 123);
      await settle();
      assert.equal(anonymous.connected, false);
      assert.equal(authenticated.connected, true);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['--unhandled-rejections=throw', '-e', script], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test('unauthenticated, invalid, expired and incomplete plugin handshakes get no handlers', async () => {
  const state = makeServer();
  const credentials = [undefined, null, {}, 123, 'invalid', token(steamId, -1)];
  for (const [index, credential] of credentials.entries()) {
    const socket = new Socket(`invalid-${index}`);
    socket.handshake.auth.token = credential;
    await state.connect(socket);
    assert.equal(socket.connected, false);
    assert.equal(socket.handlers.size, 0);
  }
  const incomplete = await state.connect(new Socket('incomplete', { 'api-key': 'owner' }));
  assert.equal(incomplete.connected, false);
  assert.equal(incomplete.handlers.size, 0);
  const invalidKey = await state.connect(plugin('invalid-key', 'unknown'));
  assert.equal(invalidKey.connected, false);
  assert.equal(invalidKey.handlers.size, 0);
  const missingIp = plugin('missing-ip', 'owner');
  delete missingIp.handshake.headers['x-forwarded-for'];
  await state.connect(missingIp);
  assert.equal(missingIp.connected, false);
  assert.equal(missingIp.handlers.size, 0);
  assert.equal(state.timers.size, 0);
});

test('authenticated roles only register their own events', async () => {
  const state = makeServer();
  const publisher = await state.connect(plugin('publisher', 'owner'));
  const socket = await state.connect(client('client', steamId));
  assert.equal(publisher.connected, true);
  assert.equal(publisher.handlers.has('player-positions'), true);
  assert.equal(publisher.handlers.has('join-room'), false);
  assert.equal(socket.handlers.has('join-room'), true);
  assert.equal(socket.handlers.has('player-positions'), false);
});

test('invalid joins and missing ACKs leave membership unchanged; a valid join still works', async () => {
  const state = makeServer();
  const publisher = await state.connect(plugin('publisher', 'owner'));
  await publisher.invoke('player-positions', 'proximity-chat', roster(steamId));
  const socket = await state.connect(client('client', steamId));
  for (const payload of [
    undefined,
    null,
    false,
    42,
    'bad',
    [],
    {},
    { ...joinData(), token: {} },
    { ...joinData(), roomCode: [] },
    { ...joinData(), isMuted: 'false' },
  ]) {
    let reply;
    await socket.invoke('join-room', payload, (value) => {
      reply = value;
    });
    assert.equal(reply.success, false);
    assert.equal(socket.joinedRooms.size, 0);
  }
  for (const ack of [undefined, null, false, 42, {}]) {
    await socket.invoke('join-room', joinData(), ack);
    assert.equal(socket.joinedRooms.size, 0);
  }
  let reply;
  await socket.invoke('join-room', joinData(), (value) => {
    reply = value;
  });
  assert.equal(reply.success, true);
  assert.equal(socket.connected, true);
  assert.equal(socket.joinedRooms.has(roomCode), true);
  await publisher.invoke('player-positions', 'proximity-chat', roster(steamId));
  const positions = state.sent.find(
    (event) => event.target === socket.id && event.event === 'player-positions',
  );
  assert.equal(decode(positions.args[0])[0][0], steamId);
});

test('valid ACK with an outdated client is a normal join rejection', async () => {
  const state = makeServer();
  const socket = client('outdated', steamId);
  delete socket.handshake.headers['user-agent'];
  await state.connect(socket);
  await socket.invoke('join-room', joinData());
  let reply;
  await socket.invoke('join-room', joinData(), (value) => {
    reply = value;
  });
  assert.equal(reply.success, false);
  assert.match(reply.message, /outdated/);
  assert.equal(socket.connected, true);
});

test('malformed client events disconnect only the offending connection', async (t) => {
  const cases = [
    ['signal', null],
    ['signal', { to: 'another', data: null }],
    ['microphone-state', null],
    ['microphone-state', { isMuted: 'false' }],
    ['mute-player', null],
    ['mute-player', { clientToken: token(steamId), targetSteamId: {} }],
    ['update-config', null],
    ['update-config', { clientToken: token(steamId), config: null }],
    ['update-config', { clientToken: token(steamId), config: { volumeMaxDistance: [] } }],
  ];
  for (const [index, [event, payload]] of cases.entries()) {
    await t.test(`${event} case ${index + 1}`, async () => {
      const state = makeServer();
      const { publisher, socket } = await joinedClient(state);
      socket.receive(event, payload);
      await settle();
      assert.equal(socket.connected, false);
      assert.equal(publisher.connected, true);
      assert.equal(socket.joinedRooms.size, 0);
      const healthy = await state.connect(client('healthy', steamId));
      let reply;
      await healthy.invoke('join-room', joinData(), (value) => {
        reply = value;
      });
      assert.equal(reply.success, true);
    });
  }
});

test('malformed plugin input is contained, including invalid MessagePack and allocation headers', async (t) => {
  const cases = [
    ['server-config', null],
    ['server-config', Buffer.from([0xc1])],
    ['server-config', Buffer.from(encode(null))],
    ['server-config', Buffer.from(encode({ VolumeMaxDistance: 'invalid' }))],
    ['player-positions', Buffer.from([0xdd, 0xff, 0xff, 0xff, 0xff])],
    ['player-positions', Buffer.from(encode([null]))],
    [
      'player-positions',
      Buffer.from(encode([[{}, 'name', false, 1, 2, 3, 1, 2, 3, 2, true, false]])),
    ],
    ['player-positions', Buffer.alloc(256 * 1024 + 1)],
    ['door-rotation', null, 1],
    ['door-rotation', '1 2 Infinity', 1],
    ['door-rotation', '1 2 3', null],
    ['current-map', {}],
  ];
  for (const [index, [event, ...args]] of cases.entries()) {
    await t.test(`${event} case ${index + 1}`, async () => {
      const state = makeServer();
      const { publisher, socket } = await joinedClient(state);
      const before = state.sent.length;
      publisher.receive(event, 'proximity-chat', ...args);
      await settle();
      assert.equal(publisher.connected, false);
      assert.equal(socket.connected, true);
      assert.equal(state.sent.length, before);
    });
  }
});

test('valid plugin config, doors and nullable admin metadata keep working', async () => {
  const state = makeServer();
  const { publisher, socket } = await joinedClient(state);
  await publisher.invoke(
    'server-config',
    'proximity-chat',
    Buffer.from(encode({ VolumeMaxDistance: 3000, AllowDeadTeamVoice: false })),
  );
  await publisher.invoke('door-rotation', 'proximity-chat', '1 2 3', 90);
  await publisher.invoke('current-map', 'proximity-chat', 'de_mirage');
  await socket.invoke('microphone-state', { isMuted: true });
  await socket.invoke('signal', { to: socket.id, data: { type: 'offer', sdp: 'review-offer' } });
  await socket.invoke('update-config', {
    clientToken: token(steamId),
    config: { volumeMaxDistance: 2000 },
  });
  await socket.invoke('mute-player', { clientToken: token(steamId), targetSteamId: steamId });
  assert.equal(publisher.connected, true);
  assert.equal(socket.connected, true);
  assert.ok(state.sent.some((event) => event.event === 'server-config'));
  assert.ok(state.sent.some((event) => event.event === 'door-rotation'));
  assert.ok(state.sent.some((event) => event.event === 'current-map'));
  assert.ok(state.sent.some((event) => event.event === 'signal' && event.target === socket.id));
  assert.ok(
    state.sent.some((event) => event.event === 'server-config' && event.target === publisher.id),
  );
  assert.ok(
    state.sent.some(
      (event) => event.event === 'muted-by-server-admin' && event.target === socket.id,
    ),
  );
  await publisher.invoke('player-positions', 'proximity-chat', roster(steamId, null));
  assert.equal(
    state.sent.filter((event) => event.event === 'player-metadata').at(-1).args[0][0].isAdmin,
    false,
  );
});

test('asynchronous publisher initialization and disconnect failures cannot escape listeners', async () => {
  const state = makeServer({
    getApiKey: async () => {
      throw new Error('test storage failure');
    },
  });
  const publisher = await state.connect(plugin('publisher', 'owner'));
  assert.equal(publisher.connected, false);
  const healthy = await state.connect(client('healthy', steamId));
  assert.equal(healthy.connected, true);

  const disconnectState = makeServer({
    loadDb: async () => {
      throw new Error('test DB failure');
    },
  });
  const disconnecting = await disconnectState.connect(plugin('disconnecting', 'owner'));
  disconnecting.disconnect();
  await settle();
  assert.equal(disconnecting.connected, false);
});
