import { Server } from 'socket.io';
import http from 'http';
import mysql, { Pool } from 'mysql2';
import dotenv from 'dotenv';
dotenv.config();

let TurnServer = require('node-turn');

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const domain = process.env.DOMAIN_URL || 'localhost';

const server = http.createServer();

let turnServer = new TurnServer({
  listeningIps: ['0.0.0.0'],
  relayIps: [],
  externalIps: null,
  minPort: 49152,
  maxPort: 65535,
  listeningPort: 3478,
  authMech: 'long-term',
  debugLevel: 'INFO',
  realm: 'cs2voiceproximity',
});

turnServer.addUser('openrelayproject', 'openrelayproject');

turnServer.start();

const io = new Server(server, {
  cors: {
    origin: isProduction ? domain : '*', // Replace with your frontend domain in production
    methods: ['GET', 'POST'],
  },
});

// TODO: pull db information from the room host
const config = {
  DatabaseHost: process.env.DATABASE_HOST,
  DatabaseUser: process.env.DATABASE_USER,
  DatabasePassword: process.env.DATABASE_PASSWORD,
  DatabaseName: process.env.DATABASE_NAME,
};

const databaseFetchRate: number = Number(process.env.DATABASE_FETCH_RATE) || 50;
let connection: Pool;
const connectionRetryDelay = 5000; // 5000ms delay if the connection fails

const getDbConnection = () => {
  connection = mysql.createPool({
    host: config.DatabaseHost,
    user: config.DatabaseUser,
    password: config.DatabasePassword,
    database: config.DatabaseName,
  });
};

const fetchProximityData = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    connection.query('SELECT * FROM ProximityData', (err: any, results: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(results);
    });
  });
};

// Query the database and send the results to connected users
const queryDatabaseAndUpdatePlayers = async () => {
  try {
    const results = await fetchProximityData();
    io.emit('player-positions', results);
    setTimeout(queryDatabaseAndUpdatePlayers, databaseFetchRate);
  } catch (err) {
    console.error('Error fetching player positions:', err);
    console.log(`Attempting db connection in ${connectionRetryDelay}ms..`);
    setTimeout(queryDatabaseAndUpdatePlayers, connectionRetryDelay);
    return;
  }
};

setTimeout(queryDatabaseAndUpdatePlayers, databaseFetchRate);

class JoinedPlayers {
  // TODO; is there any persistence for socketIds?? when page is refreshed, new id is generated.
  socketId = null;
  steamId = null;
}

class RoomData {
  roomCode_ = null;
  maxPlayers_ = 10;
  joinedPlayers = [];

  constructor(roomCode: any, maxPlayers?: any) {
    this.roomCode_ = roomCode;
    this.maxPlayers_ = maxPlayers;
  }
}

const rooms: any[] = [new RoomData('123')];

// interface JoinRoomData{
//   roomCode?: String;
//   steamId?: String;
// }

io.on('connection', (socket: any) => {
  console.log('New user connected: ', socket.id);

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on('join-room', (roomCode: any, steamId: any, clientId: any, isHost: any) => {
    //TODO; capacity limits on joining room
    //TODO: to "create a room", lobby host will need to pass in the database connection.
    //TODO: if the db connection fails (doesnt find a table), it won't create new room

    console.log(`joinRoom called with ${roomCode}, ${steamId}`);
    if (!roomCode) return; // If no room is provided, ignore the join attempt.

    let roomExists = false;
    for (const roomData of rooms) {
      if (roomData.roomCode_ === roomCode) {
        roomExists = true;
      }
    }

    if (!roomExists) {
      // TODO: "reject" the attempt so that the user is notified this room doesnt exist
      // callback({ error: "Room doesn't exist" });
      console.log('room doesnt exist, notify the user to try again!');
      return;
    }

    let newPlayer = new JoinedPlayers();
    newPlayer.socketId = socket.id;
    newPlayer.steamId = steamId;
    rooms[0].joinedPlayers.push(newPlayer);

    socket.join(roomCode);
    console.log(`${socket.id} joined room: ${roomCode} with steamid ${steamId}`);

    // callback({ success: "joined room" });

    // Notify other users in the room about the new user joining
    console.log(
      `calling user-joined with ${socket.id} ${JSON.stringify({
        steamId: steamId,
        clientId: steamId,
      })}`
    );
    socket.to(roomCode).emit('user-joined', socket.id, { steamId: steamId, clientId: steamId });

    // Handle signaling (peer-to-peer connections)
    socket.on('signal', ({ to, data }: any) => {
      io.to(to).emit('signal', {
        from: socket.id,
        data,
        client: { steamId: steamId, clientId: steamId },
      });
    });

    //TODO: handle a manual 'leave' event, removing their data from their joined room

    // Handle user disconnection
    socket.on('disconnect', () => {
      //TODO: remove them from the joinedPLayers array
      console.log(`${socket.id} disconnected`);
      socket.to(roomCode).emit('user-left', socket.id);
      socket.leave(roomCode); // Remove user from the room when they disconnect
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  if (!isProduction) {
    console.log(`Server running on http://localhost:${port}`);
  } else {
    console.log(`Running server on ${domain}:${port}`);
  }
  getDbConnection();
});
