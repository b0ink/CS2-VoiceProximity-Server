import { decode } from '@msgpack/msgpack';
import express, { Request, Response } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import mysql, { Pool, QueryError, QueryResult } from 'mysql2';
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

const dbPools: { [roomId: string]: Pool } = {};

const testDefaultRoom = '123';

// TODO: pull db information from the room host
const config = {
  DatabaseHost: process.env.DATABASE_HOST,
  DatabaseUser: process.env.DATABASE_USER,
  DatabasePassword: process.env.DATABASE_PASSWORD,
  DatabaseName: process.env.DATABASE_NAME,
};

const databaseFetchRate: number = Number(process.env.DATABASE_FETCH_RATE) || 50;
// let connection: Pool;
const connectionRetryDelay = 5000; // 5000ms delay if the connection fails

const getDbConnection = () => {
  dbPools[testDefaultRoom] = mysql.createPool({
    host: config.DatabaseHost,
    user: config.DatabaseUser,
    password: config.DatabasePassword,
    database: config.DatabaseName,
  });
};

const fetchProximityData = () => {
  return new Promise((resolve, reject) => {
    dbPools[testDefaultRoom].query(
      'SELECT * FROM ProximityData',
      (err: QueryError, results: QueryResult) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(results);
      },
    );
  });
};

// Query the database and send the results to connected users
const queryDatabaseAndUpdatePlayers = async () => {
  try {
    const results = await fetchProximityData();
    // TODO: we could hash the results per room and only emit if the data has changed
    // TODO: we could also filter out players that havent changed (standing still)
    io.volatile.to('123').emit('player-positions', results);
    setTimeout(queryDatabaseAndUpdatePlayers, databaseFetchRate);
  } catch (err) {
    console.error('Error fetching player positions:', err);
    console.log(`Attempting db connection in ${connectionRetryDelay}ms..`);
    setTimeout(queryDatabaseAndUpdatePlayers, connectionRetryDelay);
    return;
  }
};

setTimeout(queryDatabaseAndUpdatePlayers, databaseFetchRate);

const rooms: RoomData[] = [new RoomData('123')];

io.on('connection', (socket: Socket) => {
  console.log('New user connected: ', socket.id);

  socket.on('server-data', (from, data) => {
    // console.log(`Receiving server data .. .. ${JSON.stringify(data)}`);
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

      console.log(
        `${playerData.name} is at [${playerData.origin.x}, ${playerData.origin.y}, ${playerData.origin.z}]`,
      );
    }
  });

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on('join-room', (data: JoinRoomData, callback: JoinRoomCallback) => {
    //TODO; capacity limits on joining room
    //TODO: to "create a room", lobby host will need to pass in the database connection.
    //TODO: if the db connection fails (doesnt find a table), it won't create new room
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
  if (!isProduction) {
    console.log(`Server running on http://localhost:${port}`);
  } else {
    console.log(`Running server on ${domain}:${port}`);
  }
  getDbConnection();
});
