import { decode } from '@msgpack/msgpack';
import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import path from 'path';
import semver from 'semver';
import { Server, Socket } from 'socket.io';
import { DEBUG, defaultApiKey, domain, jwtSecretKey, port } from './config';
import getTurnCredential from './routes/get-turn-credential';
import verifySteam from './routes/verify-steam';
import {
  Client,
  JoinedPlayers,
  JoinRoomCallback,
  JoinRoomData,
  JwtAuthPayload,
  RoomData,
  ServerConfigData,
  ServerPlayer,
  Signal,
  SocketApiError,
  SocketApiErrorType,
} from './types';

const app = express();
app.use(express.static(path.join(__dirname, '../src/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../src/views'));
app.set('trust proxy', true);

app.get('/', (req: Request, res: Response) =>
  res.render('index', { connectedUsers: totalConnectedUsers() }),
);
app.use('/', verifySteam);
app.use('/', getTurnCredential);

const server = http.createServer(app);

// TODO: pull the latest version from the latest github release
const MINIMUM_CLIENT_VERSION = '0.1.24-alpha.0';

//

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    // origin: isProduction ? domain : '*',
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const totalConnectedUsers = () => {
  return io.of('/').sockets.size;
};
// io.engine.set('trust proxy', true);

interface ServerToClientEvents {
  'current-map': (mapName: string) => void;
  'server-config': (data: Buffer<ArrayBufferLike>) => void;
  'player-positions': (data: Buffer<ArrayBufferLike>) => void;
  exception: (string: SocketApiError) => void;
  'player-on-server': (data: { roomCode: string }) => void;
  'user-left': (socketId: string, client: Client) => void;
  'user-joined': (socketId: string, client: Client) => void;
  signal: (data: { from: string; data: string; client: Client }) => void;
  'microphone-state': (socketId: string, isMuted: boolean) => void;
}

interface ClientToServerEvents {
  'server-config': (from: string, data: Buffer<ArrayBufferLike>) => void;
  exception: SocketApiError;
  'current-map': (from: string, mapName: string) => void;
  'player-positions': (from: string, data: Buffer<ArrayBufferLike>) => void;
  'join-room': (data: JoinRoomData, callback: JoinRoomCallback) => void;
  signal: (signal: Signal) => void;
  'microphone-state': (state: { isMuted: boolean }) => void;
}

const rooms: RoomData[] = [];

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  const ua = socket.handshake.headers['user-agent'];

  // const lang = socket.handshake.headers['accept-language'];
  // console.log('User-Agent:', ua);
  // console.log('Accept-Language:', lang);

  const query = socket.handshake.query;

  const apiKey = query['api-key'];
  const serverAddress = query['server-address'];
  const serverPort = query['server-port'];
  console.log(`Apikey: ${apiKey}, serverAddress: ${serverAddress}, serverPort: ${serverPort}`);
  let inactiveServerCheck: NodeJS.Timeout;

  if (apiKey && serverAddress && serverPort) {
    if (apiKey !== defaultApiKey) {
      const socketError: SocketApiError = {
        code: SocketApiErrorType.InvalidApiKey,
        message: 'Invalid API Key',
      };
      socket.emit('exception', socketError);
      socket.disconnect();
      console.log(`Reject incoming connection (invalid api key, server address, or server port)`);
      return;
    }

    const ip = socket.handshake.headers['x-forwarded-for'];
    console.log('New connection from IP:', ip);

    if (ip !== serverAddress) {
      socket.disconnect();
      console.log(
        `IP mismatch: expected ${serverAddress}, got ${ip} (port: ${serverPort}, apiKey: ${apiKey})`,
      );
      return;
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

    socket.on('server-config', (_from: string, data: Buffer<ArrayBufferLike>) => {
      const raw = decode(new Uint8Array(data)) as Record<string, unknown>;
      const decoded: ServerConfigData = {
        deadPlayerMuteDelay: raw.DeadPlayerMuteDelay as number,
        allowDeadTeamVoice: raw.AllowDeadTeamVoice as boolean,
        allowSpectatorC4Voice: raw.AllowSpectatorC4Voice as boolean,
        rolloffFactor: raw.RolloffFactor as number,
        refDistance: raw.RefDistance as number,
        occlusionNear: raw.OcclusionNear as number | undefined,
        occlusionFar: raw.OcclusionFar as number | undefined,
        occlusionEndDist: raw.OcclusionEndDist as number | undefined,
      };
      room.serverConfig = decoded;
      if (DEBUG) {
        console.log(room.serverConfig);
      }
      io.to(serverId).emit('server-config', data);
    });

    socket.on('player-positions', (_from: string, data: Buffer<ArrayBufferLike>) => {
      if (DEBUG) {
        // const sizeKb = Buffer.byteLength(data) / 1024;
        // console.log(`Data size: ${sizeKb.toFixed(2)} KB`);
      }
      io.volatile.to(serverId).volatile.emit('player-positions', data);

      const decoded = decode(new Uint8Array(data)) as [string, string][];
      const minimalPlayerList = decoded.map(([SteamId, Name]) => ({
        SteamId,
        Name,
      })) as ServerPlayer[];
      for (const player of minimalPlayerList) {
        const playerPeer = room.joinedPlayers.find((plr) => plr.steamId === player.SteamId);
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
  }

  // TODO: check for JWT from user?

  console.log(`New user connected: ${socket.id} | ${apiKey}`);

  const authToken = socket.handshake.auth.token;

  // if (!authToken && !apiKey) {
  //   socket.disconnect();
  //   return;
  // }

  //
  let userOnServerCheck: NodeJS.Timeout;
  if (authToken) {
    // TODO: combine the two jwt verifications (one on socket connection, other in join-room check)
    let socketAuthPayload: JwtAuthPayload | null = null;
    try {
      const verified = jwt.verify(authToken, jwtSecretKey, {
        audience: domain,
      });
      socketAuthPayload = verified as JwtAuthPayload;
      if (!socketAuthPayload.steamId || socketAuthPayload.steamId == '0') {
        throw new Error('Invalid steamId');
      }
    } catch (err) {
      console.log(`Failed to verify jwt: ${err}`);
      const socketError: SocketApiError = {
        code: SocketApiErrorType.AuthExpired,
        message: 'Authentication Expired',
      };
      socket.emit('exception', socketError);
      return;
    }

    if (socketAuthPayload && socketAuthPayload.steamId) {
      // Don't run interval if this is a connection from cs2 server
      userOnServerCheck = setInterval(() => {
        const room = rooms.find((room) => {
          const onServer = room.playersOnServer.some(
            (p) => p.SteamId === socketAuthPayload.steamId,
          );
          const joinedRoom = room.joinedPlayers.some(
            (p) => p.steamId === socketAuthPayload.steamId,
          );
          return onServer && !joinedRoom;
        });

        // SteamId is connected to the CS2 server but they havent joined the room yet
        if (room && room.roomCode_) {
          socket.emit('player-on-server', { roomCode: room.roomCode_ });
        }
      }, 5000);
    }
  }

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on('join-room', (data: JoinRoomData, callback: JoinRoomCallback) => {
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

    let payload: JwtAuthPayload;
    try {
      const verified = jwt.verify(data.token, jwtSecretKey, {
        audience: domain,
      });
      payload = verified as JwtAuthPayload;
      if (!payload.steamId || payload.steamId !== data.steamId || payload.steamId == '0') {
        throw new Error('Invalid steamId');
      }
    } catch (err) {
      // TODO: pass an error code
      if (err instanceof jwt.TokenExpiredError) {
        return callback({ success: false, message: 'Token has expired' });
      } else {
        console.error(err);
        return callback({ success: false, message: 'Invalid token' });
      }
    }

    const steamIdAlreadyInARoom = rooms.some((room) =>
      room.joinedPlayers.some((player) => player.steamId === payload.steamId),
    );

    if (steamIdAlreadyInARoom) {
      return callback({
        success: false,
        message: 'This account is already connected to a room on another device.',
      });
    }

    console.log(`joinRoom called with ${data.roomCode}, ${payload.steamId}`);
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

    const joinedPlayer = room.playersOnServer.find((player) => player.SteamId === payload.steamId);
    if (!joinedPlayer) {
      if (DEBUG) {
        console.log(
          `Blocking join-room attempt from ${payload.steamId} because they are not on the server.`,
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
    newPlayer.steamId = payload.steamId;
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
      steamId: payload.steamId,
      clientId: payload.steamId,
      isMuted: data.isMuted,
    });

    console.log(JSON.stringify(room));

    const disconnectedPlayerCheck = setInterval(() => {
      if (!payload || !payload.steamId) {
        return;
      }
      const player = room.joinedPlayers.find((plr) => plr.steamId === payload.steamId);
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
          steamId: payload.steamId,
          clientId: payload.steamId,
          isMuted: false,
        });
        socket.leave(data.roomCode);
        socket.disconnect();
        clearInterval(disconnectedPlayerCheck);
      }
    }, 1000);

    console.log(
      `calling user-joined with ${socket.id} ${JSON.stringify({
        steamId: payload.steamId,
        clientId: payload.steamId,
      })}`,
    );

    // Notify other users in the room about the new user joining
    const _client = room.clients.get(socket.id);
    if (_client) {
      socket.broadcast.to(data.roomCode).emit('user-joined', socket.id, _client);
    }

    // Handle signaling (peer-to-peer connectio+ns)
    socket.on('signal', (signal: Signal) => {
      const { to, data: signalData } = signal;
      console.log(`OnSIgnal: ${JSON.stringify(data)}`);
      io.to(to).emit('signal', {
        from: socket.id,
        data: signalData,
        client: {
          steamId: data.steamId,
          clientId: data.steamId,
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
      console.log(`${socket.id} disconnected. Cleaning up.. ${payload.steamId}`);
      if (payload && payload.steamId) {
        socket.to(data.roomCode).emit('user-left', socket.id, {
          steamId: payload.steamId,
          clientId: payload.steamId,
          isMuted: false,
        });
      }

      socket.leave(data.roomCode); // Remove user from the room when they disconnect
    });
  });
});

server.listen(port, () => {
  console.log(`Server running on http://${domain}:${port}`);
});
