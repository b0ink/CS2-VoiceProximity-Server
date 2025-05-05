import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { defaultApiKey, domain, jwtSecretKey, port } from './config';
import getTurnCredential from './routes/get-turn-credential';
import verifySteam from './routes/verify-steam';
import { JoinedPlayers, JoinRoomCallback, JoinRoomData, JwtAuthPayload, RoomData } from './types';

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
    const exists = rooms.some((room) => room.roomCode_ === serverId);
    if (!exists) {
      rooms.push(new RoomData(serverId));
      console.log(`Creating new room: ${serverId}`);
      // TODO: if no request is made from this apikey/server after some time, remove the room
    }

    console.log(`Active rooms: ${JSON.stringify(rooms)}`);

    socket.on('server-data', (from, data) => {
      const sizeKb = Buffer.byteLength(data) / 1024;
      console.log(`Data size: ${sizeKb.toFixed(2)} KB`);
      io.volatile.to(serverId).emit('player-positions', data);
    });
  }

  // TODO: check for JWT from user?

  console.log(`New user connected: ${socket.id} | ${apiKey}`);

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on('join-room', (data: JoinRoomData, callback: JoinRoomCallback) => {
    //TODO; capacity limits on joining room
    console.log('user joining room');

    try {
      const verified = jwt.verify(data.token, jwtSecretKey, {
        audience: domain,
      });
      const payload = verified as JwtAuthPayload;
      if (!payload.steamId) {
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

    console.log(`joinRoom called with ${data.roomCode}, ${data.steamId}`);
    if (!data.roomCode) {
      // If no room is provided, ignore the join attempt.
      return callback({ success: false, message: 'Invalid room code' });
    }

    const roomExists = rooms.some((room) => room.roomCode_ === data.roomCode);

    if (!roomExists) {
      console.log('room doesnt exist, notify the user to try again!');
      return callback({ success: false, message: 'Room does not exist' });
    }

    const newPlayer = new JoinedPlayers();
    newPlayer.socketId = socket.id;
    newPlayer.steamId = data.steamId;
    rooms[0].joinedPlayers.push(newPlayer);

    socket.join(data.roomCode);

    callback({ success: true, message: 'Joining room' });

    console.log(
      `calling user-joined with ${socket.id} ${JSON.stringify({
        steamId: data.steamId,
        clientId: data.steamId,
      })}`,
    );

    // Notify other users in the room about the new user joining
    socket
      .to(data.roomCode)
      .emit('user-joined', socket.id, { steamId: data.steamId, clientId: data.steamId });

    // Handle signaling (peer-to-peer connectio+ns)
    socket.on('signal', ({ to, data: signalData }) => {
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
      console.log(`${socket.id} disconnected. Cleaning up.. ${data.steamId}`);
      socket
        .to(data.roomCode)
        .emit('user-left', socket.id, { steamId: data.steamId, clientId: data.steamId });
      socket.leave(data.roomCode); // Remove user from the room when they disconnect
    });
  });
});

server.listen(port, () => {
  console.log(`Server running on http://${domain}:${port}`);
});
