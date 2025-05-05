import { decode } from '@msgpack/msgpack';
import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import path from 'path';
import { Server, Socket } from 'socket.io';
import { domain, isProduction, jwtSecretKey, port } from './config';
import getTurnCredential from './routes/get-turn-credential';
import verifySteam from './routes/verify-steam';
import {
  JoinedPlayers,
  JoinRoomCallback,
  JoinRoomData,
  JwtAuthPayload,
  PlayerData,
  RoomData,
} from './types';

const app = express();
app.use(express.static(path.join(__dirname, '../src/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../src/views'));

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
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address; //?.split(',')[0]?.trim();
  const ua = socket.handshake.headers['user-agent'];
  const lang = socket.handshake.headers['accept-language'];

  console.log('New connection from IP:', ip);
  console.log('User-Agent:', ua);
  console.log('Accept-Language:', lang);

  console.log('New user connected: ', socket.id);

  socket.on('server-data', (from, data) => {
    // console.log(`Receiving server data .. .. ${JSON.stringify(data)}`);

    // TODO: don't decode the data on the server, the client will decode it
    const decoded = decode(new Uint8Array(data));
    const players = decoded as Array<
      [string, string, number, number, number, number, number, number, number, boolean]
    >;
    for (const player of players) {
      const [steamId, name, ox, oy, oz, lx, ly, lz, team, isAlive] = player;

      // Cast to PlayerData interface
      const playerData: PlayerData = {
        steamId,
        name,
        origin: { x: ox / 10000, y: oy / 10000, z: oz / 10000 },
        lookAt: { x: lx / 10000, y: ly / 10000, z: lz / 10000 },
        team,
        isAlive,
      };

      //TODO: figure out what room this server belongs to and relay the player positions
      // io.volatile.to('123').emit('player-positions', results);

      if (!isProduction) {
        console.log(
          `${playerData.name} is at [${playerData.origin.x}, ${playerData.origin.y}, ${playerData.origin.z}] Room: ${from}`,
        );
      }
    }
  });

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
