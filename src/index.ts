import cookieParser from 'cookie-parser';
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import semver from 'semver';
import { Server, Socket } from 'socket.io';
import { decode, encode } from '@msgpack/msgpack';
import { getApiKey, loadDb } from './api-keys';
import { authenticateToken } from './authenticateToken';
import {
  DEBUG,
  DOMAIN,
  PORT,
  RATELIMIT_PUBLIC_DURATION,
  RATELIMIT_PUBLIC_POINTS,
  RESTART_WARNING_SECRET,
} from './config';
import adminApiKeys from './routes/admin/keys';
import { adminRateLimit } from './routes/admin/middleware/adminRateLimit';
import getTurnCredential from './routes/get-ice-servers';
import verifySteam from './routes/verify-steam';
import {
  ClientToServerEvents,
  JoinRoomCallback,
  JoinRoomData,
  ServerConfigData,
  ServerToClientEvents,
  Signal,
  SocketApiError,
  SocketApiErrorType,
} from './shared-types';
import { JoinedPlayers, RoomData, ServerPlayer } from './types';
import { decodePlayerData } from './utils/decode';

const app = express();
app.use(express.static(path.join(__dirname, '../src/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../src/views'));
app.set('trust proxy', true);

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req: Request, res: Response) =>
  res.render('index', {
    connectedUsers: totalConnectedUsers(),
    connectedServers: totalConnectdServers(),
  }),
);
app.use('/', verifySteam);
app.use('/', getTurnCredential);
app.use('/admin', adminApiKeys);

const server = http.createServer(app);

// TODO: pull the latest version from the latest github release
const MINIMUM_CLIENT_VERSION = '0.1.37-alpha.0';
const MINIMUM_PLUGIN_VERSION = '0.0.27';

const rateLimiter = new RateLimiterMemory({
  points: RATELIMIT_PUBLIC_POINTS,
  duration: RATELIMIT_PUBLIC_DURATION,
});

app.post(
  '/admin/restart-warning',
  adminRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const auth = req.get('Authorization');
    if (!auth || auth !== `Bearer ${RESTART_WARNING_SECRET}`) {
      res.sendStatus(401);
      return;
    }
    const minutes = req.body.minutes || 1;
    io.emit('server-restart-warning', { minutes });
    res.sendStatus(200);
  },
);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    // origin: IS_PRODUCTION ? DOMAIN : '*',
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const totalConnectedUsers = () => {
  return io.of('/').sockets.size - rooms.length;
};

const totalConnectdServers = () => {
  return rooms.length;
};
// io.engine.set('trust proxy', true);

const rooms: RoomData[] = [];

io.on('connection', async (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  const ua = socket.handshake.headers['user-agent'];

  // const lang = socket.handshake.headers['accept-language'];
  // console.log('User-Agent:', ua);
  // console.log('Accept-Language:', lang);

  const query = socket.handshake.query;

  let connectedAt = Date.now();

  const apiKey = typeof query['api-key'] === 'string' ? query['api-key'] : null;
  const serverAddress = query['server-address'];
  const serverPort = query['server-port'];
  const pluginVersion = query['plugin-version'];
  console.log(
    `Apikey: ${apiKey}, serverAddress: ${serverAddress}, serverPort: ${serverPort}, pluginVersion: ${pluginVersion}`,
  );
  let inactiveServerCheck: NodeJS.Timeout;

  if (apiKey && serverAddress && serverPort && pluginVersion) {
    const apiKeyData = await getApiKey(apiKey);
    if (!apiKeyData || !apiKeyData.isActive()) {
      const socketError: SocketApiError = {
        code: SocketApiErrorType.InvalidApiKey,
        message:
          apiKeyData?.isActive() === false
            ? 'Your API key has expired.'
            : 'Invalid API Key set, please ensure you have the correct Region (SocketURL) set.',
      };
      socket.emit('exception', socketError);
      socket.disconnect();
      console.log(`Reject incoming connection (invalid api key, server address, or server PORT)`);
      return;
    }

    if (
      typeof pluginVersion !== 'string' ||
      !pluginVersion ||
      !semver.satisfies(pluginVersion, `>=${MINIMUM_PLUGIN_VERSION}`)
    ) {
      console.log(`Checking plugin version: ${pluginVersion} with ${MINIMUM_PLUGIN_VERSION}`);
      socket.emit('exception', {
        code: SocketApiErrorType.PluginOutdated,
        message:
          'Please update the Proximity Chat plugin to the latest version. https://github.com/b0ink/CS2-VoiceProximity-Plugin/releases/latest',
      });
      socket.disconnect();
      return;
    }

    const ips = socket.handshake.headers['x-forwarded-for'];
    if (!ips || typeof ips !== 'string') {
      socket.emit('exception', {
        code: SocketApiErrorType.InvalidServerIp,
        message: 'Invalid IP found in socket connection',
      });
      return;
    }

    // should contain both actual ip and the cloudflare proxy ip
    // we want to get the servers actual ip
    const ip = ips.indexOf(',') == -1 ? ips : ips.split(',')[0].trim();

    console.log('New connection from IP:', ip);

    if (ip !== serverAddress) {
      socket.emit('exception', {
        code: SocketApiErrorType.InvalidServerIp,
        message: 'IP mismatch between CS2 server and incoming connection.',
      });
      socket.disconnect();
      console.log(
        `IP mismatch: expected ${serverAddress}, got ${ip} (PORT: ${serverPort}, apiKey: ${apiKey})`,
      );
      return;
    }

    const existingRoom = rooms.find((room) => apiKeyData.id && room.apiKeyId === apiKeyData.id);
    const oldSocketId = existingRoom?.serverSocketId;
    // Close previous socket connections using the same api key
    if (existingRoom && oldSocketId) {
      console.log(`my socket id: ${socket.id} - previous socket id: ${oldSocketId}`);
      if (socket.id !== oldSocketId) {
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          console.log(`Destroy previous socket connection... ${oldSocketId}`);
          existingRoom.serverSocketId = undefined;
          oldSocket.emit('exception', {
            code: SocketApiErrorType.ReusedApiKey,
            message:
              'Socket disconnected due to API key being used on another server. You can ignore this if you have recently reloaded the plugin.',
          });
          oldSocket.disconnect();
        }
      }
    }

    const serverId = `${serverAddress}:${serverPort}`;
    let room = rooms.find((room) => room.roomCode_ === serverId);

    if (!room) {
      room = new RoomData(serverId);
      rooms.push(room);
      console.log(`Creating new room: ${serverId}`);
      // TODO: if no request is made from this apikey/server after some time, remove the room
    }

    console.log(`Active rooms: ${JSON.stringify(rooms)}`);

    // Track the socket id of the CS2 Server
    room.serverSocketId = socket.id;
    room.apiKeyId = apiKeyData.id;

    socket.on('server-config', (_from: string, data: Buffer<ArrayBufferLike>) => {
      const raw = decode(new Uint8Array(data)) as Record<string, unknown>;
      const decoded: ServerConfigData = {
        deadPlayerMuteDelay: (raw.DeadPlayerMuteDelay as number | undefined) ?? 1000,
        allowDeadTeamVoice: (raw.AllowDeadTeamVoice as boolean | undefined) ?? true,
        allowSpectatorC4Voice: (raw.AllowSpectatorC4Voice as boolean | undefined) ?? true,
        volumeFalloffFactor: (raw.VolumeFalloffFactor as number | undefined) ?? 0.5,
        volumeMaxDistance: (raw.VolumeMaxDistance as number | undefined) ?? 2000,
        occlusionNear: (raw.OcclusionNear as number | undefined) ?? 300,
        occlusionFar: (raw.OcclusionFar as number | undefined) ?? 25,
        occlusionEndDist: (raw.OcclusionEndDist as number | undefined) ?? 2000,
        occlusionFalloffFactor: (raw.OcclusionFalloffFactor as number | undefined) ?? 3,
        alwaysHearVisiblePlayers: (raw.AlwaysHearVisiblePlayers as boolean | undefined) ?? true,
        deadVoiceFilterFrequency: (raw.DeadVoiceFilterFrequency as number | undefined) ?? 750,
        spectatorsCanTalk: (raw.SpectatorsCanTalk as boolean | undefined) ?? false,
      };
      room.serverConfig = decoded;
      if (DEBUG) {
        console.log(room.serverConfig);
      }
      io.to(serverId).emit('server-config', data);
    });

    socket.on('door-rotation', (from, origin, rotation) => {
      const originValues = origin.split(' ');
      if (originValues.length !== 3 || originValues.some((v) => isNaN(Number(v)))) {
        return;
      }
      const absorigin = {
        x: Number(originValues[0]),
        y: Number(originValues[1]),
        z: Number(originValues[2]),
      };
      io.to(serverId).emit('door-rotation', {
        absorigin,
        rotation,
      });
    });

    socket.on('player-positions', (_from: string, data: Buffer<ArrayBufferLike>) => {
      const secondsSinceUpdate = Date.now() / 1000 - room.lastUpdateFromServer;

      if (DEBUG) {
        // const sizeKb = Buffer.byteLength(data) / 1024;
        // console.log(`Data size: ${sizeKb.toFixed(2)} KB`);
        // console.log(`seconds since update from socket: ${socket.id}: ${secondsSinceUpdate}`);
      }

      if (secondsSinceUpdate < 0.09) {
        // console.log('Update from server was too quick, ignoring');
        return;
      }

      const players = decodePlayerData(data);

      // Only include position data for players currently in the voice chat
      const filteredPlayers = players.filter((p) => {
        const joinedPlayer = room.joinedPlayers.find((plr) => plr.steamId === p.steamId);
        return joinedPlayer && Date.now() / 1000 - joinedPlayer.lastTimeOnServer <= 5;
      });

      // Reduce broadcast rate to 1/s if theres less than 2 players in the room
      if (filteredPlayers.length <= 1 && secondsSinceUpdate < 0.9) {
        return;
      }

      // re-encode filtered player list to send clients
      const encodedPlayers: Buffer = Buffer.from(
        encode(
          filteredPlayers.map((p) => [
            p.steamId,
            p.name,
            p.isAdmin,
            p.originX,
            p.originY,
            p.originZ,
            p.lookAtX,
            p.lookAtY,
            p.lookAtZ,
            p.team,
            p.isAlive,
            p.spectatingC4,
          ]),
        ),
      );

      io.volatile.to(serverId).emit('player-positions', encodedPlayers);

      // const decoded = decode(new Uint8Array(data)) as [string, string, boolean][];
      const minimalPlayerList = players.map((p) => ({
        SteamId: p.steamId,
        Name: p.name,
        isAdmin: p.isAdmin,
      })) as ServerPlayer[];

      for (const player of filteredPlayers) {
        const playerPeer = room.joinedPlayers.find((plr) => plr.steamId === player.steamId);
        if (playerPeer) {
          playerPeer.lastTimeOnServer = Date.now() / 1000;
        } else {
          // TODO: remove them from the array to save on bandwidth
        }
      }
      room.playersOnServer = minimalPlayerList;
      room.lastUpdateFromServer = Date.now() / 1000;
    });

    socket.on('current-map', (_from: string, mapName: string) => {
      const room = rooms.find((room) => room.roomCode_ === serverId);
      if (room) {
        room.mapName = mapName;
        if (DEBUG) {
          console.log(`Setting ${serverId} map to ${mapName}`);
        }
      }
      io.to(serverId).emit('current-map', mapName);
    });

    inactiveServerCheck = setInterval(() => {
      if (room.lastUpdateFromServer > 0 && Date.now() / 1000 - room.lastUpdateFromServer > 60) {
        if (DEBUG) {
          console.log('Destroying room');
        }
        io.to(serverId).emit('exception', {
          code: SocketApiErrorType.RoomShutdown,
          message: 'You have been disconnected because the room no longer exists.',
        });
        io.to(serverId).disconnectSockets();
        socket.disconnect();
        room.joinedPlayers = [];
        room.playersOnServer = [];
        rooms.splice(
          rooms.findIndex((room) => room.roomCode_ === serverId),
          1,
        );
        clearInterval(inactiveServerCheck);
      }
    }, 1000);
    socket.on('disconnect', async () => {
      const durationMs = Date.now() - connectedAt;
      console.log(`Socket ${socket.id} was connected for ${durationMs} ms`);
      const db = await loadDb();
      const key = db.data.find((k) => k.id === apiKeyData.id);
      if (key) {
        key.usage += Math.floor(durationMs / 1000);
        await db.write();
      }
      connectedAt = Date.now();
    });
  }

  console.log(`New user connected: ${socket.id} | ${apiKey}`);

  const authToken = socket.handshake.auth.token;

  // if (!authToken && !apiKey) {
  //   socket.disconnect();
  //   return;
  // }

  //
  let userOnServerCheck: NodeJS.Timeout;
  if (authToken) {
    const auth = authenticateToken(authToken);
    if (!auth.valid || auth.payload === null) {
      socket.emit('exception', {
        code: SocketApiErrorType.AuthExpired,
        message: 'Authentication Expired',
      });
      return;
    }

    const validSteamId = auth.payload.steamId;
    if (validSteamId) {
      // Don't run interval if this is a connection from cs2 server
      userOnServerCheck = setInterval(() => {
        const room = rooms.find((room) => {
          const onServer = room.playersOnServer.some((p) => p.SteamId === validSteamId);
          const joinedRoom = room.joinedPlayers.some((p) => p.steamId === validSteamId);
          return onServer && !joinedRoom;
        });

        // SteamId is connected to the CS2 server but they havent joined the room yet
        if (room && room.roomCode_) {
          const secondsSinceUpdate = Date.now() / 1000 - room.lastUpdateFromServer;
          // Ensure data is fresh before notifying the user
          if (secondsSinceUpdate < 3) {
            socket.emit('player-on-server', { roomCode: room.roomCode_ });
          }
        }
      }, 5000);
    }
  }

  // Handle joining a room
  socket.on('join-room', async (data: JoinRoomData, callback: JoinRoomCallback) => {
    //TODO; capacity limits on joining room
    console.log('user joining room');

    const clientVersion = ua?.split('CS2VoiceProximity/')[1];
    if (
      !clientVersion ||
      !semver.satisfies(clientVersion, `>=${MINIMUM_CLIENT_VERSION}`, { includePrerelease: true })
    ) {
      console.log(`Checking clients version: ${clientVersion} with ${MINIMUM_CLIENT_VERSION}`);
      return callback({
        success: false,
        message: 'Your client version is outdated. Please update before joining the room.',
      });
    }

    const auth = authenticateToken(data.token);
    const validSteamId = auth.payload?.steamId;
    if (!auth.valid || auth.payload === null || !validSteamId) {
      socket.emit('exception', {
        code: SocketApiErrorType.AuthExpired,
        message: 'Authentication Expired',
      });
      return;
    }

    if (!auth.valid || !auth.payload || !auth.payload.steamId) {
      return callback({ success: false, message: 'Authentication Expired' });
    }

    try {
      await rateLimiter.consume(auth.payload.steamId);
    } catch (rejReason) {
      console.log(rejReason);
      return callback({ success: false, message: 'Rate limit hit' });
    }

    const steamIdAlreadyInARoom = rooms.some((room) =>
      room.joinedPlayers.some((player) => player.steamId === validSteamId),
    );

    if (steamIdAlreadyInARoom) {
      return callback({
        success: false,
        message: 'This account is already connected to a room on another device.',
      });
    }

    console.log(`joinRoom called with ${data.roomCode}, ${validSteamId}`);
    if (!data.roomCode) {
      // If no room is provided, ignore the join attempt.
      return callback({ success: false, message: 'Invalid room code' });
    }

    // const roomExists = rooms.some((room) => room.roomCode_ === data.roomCode);
    const room = rooms.find((room) => room.roomCode_ === data.roomCode);

    if (!room) {
      console.log('room doesnt exist, notify the user to try again!');
      return callback({ success: false, message: 'Room does not exist' });
    }

    const joinedPlayer = room.playersOnServer.find((player) => player.SteamId === validSteamId);
    if (!joinedPlayer) {
      if (DEBUG) {
        console.log(
          `Blocking join-room attempt from ${validSteamId} because they are not on the server.`,
        );
      }

      // Ensure the joining steamid is currently on the server
      // This allows password protection of rooms to be handled by the server instead of the client
      // (eg. set sv_password on the server)
      return callback({
        success: false,
        message: 'You must be on the server before joining the room',
      });
    }

    const newPlayer = new JoinedPlayers();
    newPlayer.socketId = socket.id;
    newPlayer.steamId = validSteamId;
    room.joinedPlayers.push(newPlayer);

    socket.join(data.roomCode);

    callback({
      success: true,
      message: 'Joining room',
      mapName: room.mapName,
      joinedClients: Object.fromEntries(room.clients),
      serverConfig: room.serverConfig,
    });

    room.clients.set(socket.id, {
      steamId: validSteamId,
      isMuted: data.isMuted,
    });

    console.log(JSON.stringify(room));

    const disconnectedPlayerCheck = setInterval(() => {
      if (!validSteamId) {
        return;
      }
      const player = room.joinedPlayers.find((plr) => plr.steamId === validSteamId);
      if (!player) {
        clearInterval(disconnectedPlayerCheck);
        return;
      }
      if (player.lastTimeOnServer > 0 && Date.now() / 1000 - player.lastTimeOnServer > 5) {
        if (DEBUG) {
          console.log('Disconnecting player');
        }
        room.joinedPlayers = room.joinedPlayers.filter((player) => player.socketId !== socket.id);
        socket.to(data.roomCode).emit('user-left', socket.id, {
          steamId: validSteamId,
          isMuted: false,
        });
        socket.leave(data.roomCode);
        socket.emit('exception', {
          code: SocketApiErrorType.PlayerDisconnected,
          message: 'You have been disconnected because you are no longer on the server.',
        });
        socket.disconnect();
        clearInterval(disconnectedPlayerCheck);
      }
    }, 1000);

    console.log(
      `calling user-joined with ${socket.id} ${JSON.stringify({
        steamId: validSteamId,
      })}`,
    );

    // Notify other users in the room about the new user joining
    const _client = room.clients.get(socket.id);
    if (_client) {
      socket.broadcast.to(data.roomCode).emit('user-joined', socket.id, _client);
    }

    socket.on('mute-player', async (data) => {
      const auth = authenticateToken(data.clientToken);
      const steamid = auth.payload?.steamId;
      if (!auth.valid || !steamid) {
        return;
      }

      if (!room || !room.roomCode_) {
        return;
      }

      const player = room.playersOnServer.find((p) => p.SteamId === steamid);
      if (!player?.isAdmin) {
        console.log(`Non-admin tried to mute another player!`);
        return;
      }

      const playerToMute = room.joinedPlayers.find((p) => p.steamId === data.targetSteamId);
      if (!playerToMute || !playerToMute.socketId) {
        console.log(`Tried to mute a player that isnt in the room!: ${data.targetSteamId}`);
        return;
      }

      try {
        await rateLimiter.consume(player.SteamId);
        io.to(playerToMute.socketId).emit('muted-by-server-admin');
      } catch (rejectReason) {
        console.log(`Rate limited exceeded by ${player.SteamId} (${rejectReason})`);
      }
    });

    socket.on('update-config', async (data) => {
      const auth = authenticateToken(data.clientToken);
      const steamid = auth.payload?.steamId;
      if (!auth.valid || !steamid) {
        return;
      }

      if (!room || !room.roomCode_) {
        return;
      }

      const player = room.playersOnServer.find((p) => p.SteamId === steamid);
      if (!player?.isAdmin) {
        console.log(`Non-admin tried to update the config!`);
        return;
      }

      console.log(`updating config`, JSON.stringify(data));
      const config = { ...room.serverConfig };

      for (const key of Object.keys(room.serverConfig) as (keyof ServerConfigData)[]) {
        assignConfigKey(config, data.config, room.serverConfig, key);
      }

      room.serverConfig = config;
      const buffer: Buffer = Buffer.from(encode(config));

      try {
        await rateLimiter.consume(player.SteamId);
        io.to(room.roomCode_).emit('server-config', buffer);
        if (room.serverSocketId) {
          io.to(room.serverSocketId).emit(
            'server-config',
            Buffer.from(
              encode({
                DeadPlayerMuteDelay: config.deadPlayerMuteDelay,
                AllowDeadTeamVoice: config.allowDeadTeamVoice,
                AllowSpectatorC4Voice: config.allowSpectatorC4Voice,
                VolumeFalloffFactor: config.volumeFalloffFactor,
                VolumeMaxDistance: config.volumeMaxDistance,
                OcclusionNear: config.occlusionNear,
                OcclusionFar: config.occlusionFar,
                OcclusionEndDist: config.occlusionEndDist,
                OcclusionFalloffFactor: config.occlusionFalloffFactor,
                AlwaysHearVisiblePlayers: config.alwaysHearVisiblePlayers,
              }),
            ),
          );
        }
      } catch (rejectReason) {
        console.log(`Rate limited exceeded by ${player.SteamId} (${rejectReason})`);
      }
    });

    // Handle signaling (peer-to-peer connectio+ns)
    socket.on('signal', (signal: Signal) => {
      const { to, data: signalData } = signal;
      console.log(`OnSIgnal: ${JSON.stringify(data)}`);
      io.to(to).emit('signal', {
        from: socket.id,
        data: signalData,
        client: {
          steamId: data.steamId,
          isMuted: room.clients.get(socket.id)?.isMuted ?? false,
        },
      });
    });

    socket.on('microphone-state', (state: { isMuted: boolean }) => {
      const client = room.clients.get(socket.id);
      if (client) {
        client.isMuted = state.isMuted;
        socket.broadcast.to(data.roomCode).emit('microphone-state', socket.id, state.isMuted);
      } else {
        console.error(
          'Tried to update microphone-state for a client that doesnt exist in the room',
        );
      }
    });

    //TODO: handle a manual 'leave' event, removing their data from their joined room

    // Handle user disconnection
    socket.on('disconnect', () => {
      //TODO: remove them from the joinedPLayers array
      // Evict player object

      clearInterval(userOnServerCheck);
      clearInterval(disconnectedPlayerCheck);
      clearInterval(inactiveServerCheck);

      for (const room of rooms) {
        room.joinedPlayers = room.joinedPlayers.filter((player) => player.socketId !== socket.id);
        room.clients.delete(socket.id);
      }
      console.log(`${socket.id} disconnected. Cleaning up.. ${validSteamId}`);
      if (validSteamId) {
        socket.to(data.roomCode).emit('user-left', socket.id, {
          steamId: validSteamId,
          isMuted: false,
        });
      }

      socket.leave(data.roomCode); // Remove user from the room when they disconnect
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on ${DOMAIN}:${PORT}`);
});

function assignConfigKey<K extends keyof ServerConfigData>(
  config: ServerConfigData,
  dataConfig: Partial<ServerConfigData>,
  roomConfig: ServerConfigData,
  key: K,
) {
  config[key] = dataConfig[key] ?? roomConfig[key];
}
