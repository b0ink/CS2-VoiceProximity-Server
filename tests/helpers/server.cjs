// Executes current API source with synthetic credentials and no network, disk DB, or .env access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jwt = require('jsonwebtoken');
const { encode } = require('@msgpack/msgpack');

const serverRoot = path.resolve(__dirname, '../..');
const config = {
  JWT_SECRET_KEY: 'isolated-review-test-secret',
  DOMAIN: 'https://review.invalid',
  PORT: 0,
  DEBUG: false,
  RESTART_WARNING_SECRET: 'review-only',
  RATELIMIT_PUBLIC_POINTS: 100,
  RATELIMIT_PUBLIC_DURATION: 60,
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

function loadSource(file, overrides = {}, globals = {}, cache = new Map()) {
  const absolute = path.resolve(serverRoot, 'src', file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = { exports: {} };
  cache.set(absolute, mod);
  const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('.')) return require(name);
    const next = path.resolve(path.dirname(absolute), `${name}.ts`);
    return loadSource(path.relative(path.join(serverRoot, 'src'), next), overrides, globals, cache);
  };
  const context = {
    Buffer,
    Uint8Array,
    URL,
    URLSearchParams,
    Date,
    Map,
    Set,
    console: { log() {}, error() {} },
    setInterval,
    clearInterval,
    ...globals,
  };
  vm.runInNewContext('(function(require,module,exports,__dirname){' + compiled + '\n})', context, {
    filename: absolute,
  })(localRequire, mod, mod.exports, path.dirname(absolute));
  return mod.exports;
}

class Socket {
  constructor(id, query = {}, headers = {}) {
    this.id = id;
    this.handshake = { query, headers, auth: {} };
    this.handlers = new Map();
    this.sent = [];
    this.joinedRooms = new Set();
    this.connected = true;
    this.broadcast = { to: () => ({ emit() {} }) };
  }
  on(event, fn) {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(fn);
    this.handlers.set(event, handlers);
  }
  emit(...args) {
    this.sent.push(args);
  }
  join(room) {
    this.joinedRooms.add(room);
  }
  leave(room) {
    this.joinedRooms.delete(room);
  }
  to() {
    return { emit() {} };
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.receive('disconnect');
  }
  receive(event, ...args) {
    // Socket.IO/EventEmitter does not await async event listeners.
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
  async invoke(event, ...args) {
    for (const fn of this.handlers.get(event) ?? []) await fn(...args);
  }
}

function makeServer(options = {}) {
  let connection;
  const timers = new Map();
  let timerId = 0;
  const sockets = new Map();
  const sent = [];
  const keys = new Map(['owner', 'other'].map((id) => [id, { id, isActive: () => true }]));
  class FakeServer {
    constructor() {
      this.sockets = { sockets };
    }
    on(event, fn) {
      if (event === 'connection') connection = fn;
    }
    of() {
      return { sockets };
    }
    to(target) {
      return {
        emit: (event, ...args) => sent.push({ target, event, args }),
        disconnectSockets() {},
      };
    }
    get volatile() {
      return this;
    }
    emit() {}
  }
  const noopRoute = (_req, _res, next) => next();
  loadSource(
    'index.ts',
    {
      './config': config,
      './api-keys': {
        getApiKey: options.getApiKey ?? (async (key) => keys.get(key)),
        loadDb: options.loadDb ?? (async () => ({ data: [], write: async () => {} })),
      },
      http: { createServer: () => ({ listen() {} }) },
      'socket.io': { Server: FakeServer },
      './routes/admin/keys': noopRoute,
      './routes/admin/middleware/adminRateLimit': { adminRateLimit: noopRoute },
      './routes/get-ice-servers': noopRoute,
      './routes/verify-steam': noopRoute,
    },
    {
      setInterval: (fn, delay) => {
        timers.set(++timerId, { fn, delay });
        return timerId;
      },
      clearInterval: (id) => timers.delete(id),
    },
  );
  return {
    timers,
    sockets,
    sent,
    keys,
    async connect(socket) {
      sockets.set(socket.id, socket);
      await connection(socket);
      await settle();
      return socket;
    },
  };
}

function token(steamId, expiresIn = '1h') {
  return jwt.sign({ steamId }, config.JWT_SECRET_KEY, { audience: config.DOMAIN, expiresIn });
}
function plugin(id, key, ip = '192.0.2.10', port = '27015') {
  return new Socket(
    id,
    { 'api-key': key, 'server-address': ip, 'server-port': port, 'plugin-version': '3.1.0' },
    { 'x-forwarded-for': ip },
  );
}
function client(id, steamId) {
  const socket = new Socket(id, {}, { 'user-agent': 'CS2VoiceProximity/1.1.0-alpha.2' });
  socket.handshake.auth.token = token(steamId);
  return socket;
}
const roster = (steamId, isAdmin = false) =>
  Buffer.from(encode([[steamId, 'Review player', isAdmin, 1, 2, 3, 1, 2, 3, 2, true, false, {}]]));

module.exports = { config, loadSource, makeServer, Socket, token, plugin, client, roster, settle };
