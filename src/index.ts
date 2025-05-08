import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { DEBUG, defaultApiKey, domain, jwtSecretKey, port } from './config';
import getTurnCredential from './routes/get-turn-credential';
import verifySteam from './routes/verify-steam';
import {
  JoinedPlayers,
  JoinRoomCallback,
  JoinRoomData,
  JwtAuthPayload,
  RoomData,
  ServerPlayer,
} from './types';
import { decode } from '@msgpack/msgpack';

const app = express();
app.use(express.static(path.join(__dirname, '../src/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../src/views'));
app.set('trust proxy', true);

app.get('/', (req: Request, res: Response) => res.render('index'));
app.use('/', verifySteam);
app.use('/', getTurnCredential);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    // origin: isProduction ? domain : '*',
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
// io.engine.set('trust proxy', true);

const testDefaultRoom = '123';

const rooms: RoomData[] = [new RoomData(testDefaultRoom)];

io.on('connection', (socket: Socket) => {
  // const ua = socket.handshake.headers['user-agent'];
  // const lang = socket.handshake.headers['accept-language'];
  // console.log('User-Agent:', ua);
  // console.log('Accept-Language:', lang);

  const query = socket.handshake.query;

  const apiKey = query['api-key'];
  const serverAddress = query['server-address'];
  const serverPort = query['server-port'];
  console.log(`Apikey: ${apiKey}, serverAddress: ${serverAddress}, serverPort: ${serverPort}`);
  if (apiKey && serverAddress && serverPort) {
    if (apiKey !== defaultApiKey) {
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

    socket.on('player-positions', (from, data) => {
      // const sizeKb = Buffer.byteLength(data) / 1024;
      // console.log(`Data size: ${sizeKb.toFixed(2)} KB`);
      io.volatile.to(serverId).emit('player-positions', data);

      const decoded = decode(new Uint8Array(data)) as [string, string][];
      const minimalPlayerList = decoded.map(([SteamId, Name]) => ({
        SteamId,
        Name,
      })) as ServerPlayer[];
      room.playersOnServer = minimalPlayerList;
      room.lastUpdateFromServer = Date.now() / 1000;
    });

    socket.on('current-map', (from, mapName: string) => {
      const room = rooms.find((room) => room.roomCode_ === serverId);
      if (room) {
        room.mapName = mapName;
        if (DEBUG) {
          console.log(`Setting ${serverId} map to ${mapName}`);
        }
      }
      io.to(serverId).emit('current-map', mapName);
    });

    const interval = setInterval(() => {
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
        clearInterval(interval);
      }
    }, 1000);
  }

  // TODO: check for JWT from user?

  console.log(`New user connected: ${socket.id} | ${apiKey}`);

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on('join-room', (data: JoinRoomData, callback: JoinRoomCallback) => {
    //TODO; capacity limits on joining room
    console.log('user joining room');

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

    callback({ success: true, message: 'Joining room', mapName: room.mapName });

    // TODO: players won't be in room.playersOnServer during map changes, need to find a better way
    // TODO: maybe this is a setting the server can enable, eg. "removeDisconnectedPlayersFromVoice"
    // TODO: with the warning that long map changes (workshop downloads) will disconnect them and they need to rejoin the room again
    // setInterval(() => {
    //   if (room && room.playersOnServer.find((player) => player.SteamId == payload.steamId)) {
    //     console.log('steamId is inside the room');
    //   } else {
    //     room.joinedPlayers = room.joinedPlayers.filter((player) => player.socketId !== socket.id);
    //     socket
    //       .to(data.roomCode)
    //       .emit('user-left', socket.id, { steamId: payload.steamId, clientId: payload.steamId });
    //     socket.leave(data.roomCode);
    //     // TODO: disconnect client from any peer voice connections
    //   }
    // }, 1000);

    console.log(
      `calling user-joined with ${socket.id} ${JSON.stringify({
        steamId: payload.steamId,
        clientId: payload.steamId,
      })}`,
    );

    // Notify other users in the room about the new user joining
    socket
      .to(data.roomCode)
      .emit('user-joined', socket.id, { steamId: data.steamId, clientId: data.steamId });

    // Handle signaling (peer-to-peer connectio+ns)
    socket.on('signal', ({ to, data: signalData }) => {
      console.log(`OnSIgnal: ${JSON.stringify(data)}`);
      io.to(to).emit('signal', {
        from: socket.id,
        data: signalData,
        client: { steamId: data.steamId, clientId: data.steamId },
      });
    });

    //TODO: handle a manual 'leave' event, removing their data from their joined room

    // Handle user disconnection
    socket.on('disconnect', () => {
      //TODO: remove them from the joinedPLayers array
      // Evict player object
      for (const room of rooms) {
        room.joinedPlayers = room.joinedPlayers.filter((player) => player.socketId !== socket.id);
      }
      console.log(`${socket.id} disconnected. Cleaning up.. ${payload.steamId}`);
      socket
        .to(data.roomCode)
        .emit('user-left', socket.id, { steamId: payload.steamId, clientId: payload.steamId });
      socket.leave(data.roomCode); // Remove user from the room when they disconnect
    });
  });
});

server.listen(port, () => {
  console.log(`Server running on http://${domain}:${port}`);
});
