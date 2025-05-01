import { Server } from 'socket.io';
import http from 'http';
import mysql, { Pool } from 'mysql2';
import dotenv from 'dotenv';
import { JwtAuthPayload, SteamOpenIDParams } from './types';
import jwt from 'jsonwebtoken';

dotenv.config();

let TurnServer = require('node-turn');

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const domain = process.env.DOMAIN_URL || 'localhost';
const jwtSecretKey = process.env.JWT_SECRET_KEY || null;

if (jwtSecretKey === null) {
  throw Error('Invalid or no JWT_SECRET_KEY provided in environment variables.');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/verify-steam')) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    const params: SteamOpenIDParams = {
      ns: url.searchParams.get('openid.ns') || undefined,
      mode: url.searchParams.get('openid.mode') || undefined,
      op_endpoint: url.searchParams.get('openid.op_endpoint') || undefined,
      claimed_id: url.searchParams.get('openid.claimed_id') || undefined,
      identity: url.searchParams.get('openid.identity') || undefined,
      return_to: url.searchParams.get('openid.return_to') || undefined,
      response_nonce: url.searchParams.get('openid.response_nonce') || undefined,
      assoc_handle: url.searchParams.get('openid.assoc_handle') || undefined,
      signed: url.searchParams.get('openid.signed') || undefined,
      sig: url.searchParams.get('openid.sig') || undefined,
    };

    const steamId64 = params.identity!.split('.com/openid/id/')[1];
    const isPayloadValid = await validateSteamAuth(params);
    // console.log(`is the payload valid?: ${isPayloadValid}`);

    if (!isPayloadValid || !steamId64) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body>
          <p>Failed to authenticate, please try again!</p>
          </body>
        </html>
      `);
      return;
    }

    const jwtPayload: JwtAuthPayload = {
      steamId: steamId64,
      iat: Math.floor(Date.now() / 1000),
      // exp: Math.floor(Date.now() / 1000) + 30,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days expiry
      aud: domain,
    };

    const token = await jwt.sign(jwtPayload, jwtSecretKey);
    // console.log(token);

    const redirectUrl = `${process.env.REDIRECT_URL_PROTOCOL}?token=${token}`;
    console.log('Authenticating steam id via /verify-steam ...');
    // console.log(`Redirecting to ${redirectUrl}`);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <body>
        <p>You've signed in. You can now close this page.</p>
        <script>
        window.location.href = "${redirectUrl}";
        </script>
        </body>
      </html>
    `);
  }
});

async function validateSteamAuth(payload: SteamOpenIDParams): Promise<boolean> {
  const params = new URLSearchParams({
    'openid.ns': payload.ns!,
    'openid.op_endpoint': payload.op_endpoint!,
    'openid.claimed_id': payload.claimed_id!,
    'openid.identity': payload.identity!,
    'openid.return_to': payload.return_to!,
    'openid.response_nonce': payload.response_nonce!,
    'openid.assoc_handle': payload.assoc_handle!,
    'openid.signed': payload.signed!,
    'openid.sig': payload.sig!,
    'openid.mode': 'check_authentication',
  });

  const response = await fetch('https://steamcommunity.com/openid/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  // console.log(`Validating steam auth response:\n---\n${text}\n---`);
  return text.includes('is_valid:true');
}

const relayIps = process.env.RELAY_IPS?.split(',');
const externalIps = process.env.EXTERNAL_IPS?.split(',');

let turnServer = new TurnServer({
  listeningIps: ['0.0.0.0'],
  relayIps: relayIps || [],
  externalIps: externalIps || null,
  minPort: 49152,
  maxPort: 65535,
  listeningPort: 3478,
  authMech: 'long-term',
  debugLevel: 'INFO',
  realm: 'cs2voiceproximity',
});

if (!isProduction) {
  turnServer.listeningIps = ['127.0.0.1'];
  turnServer.relayIps = ['127.0.0.1'];
  turnServer.externalIps = ['127.0.0.1'];
}

turnServer.addUser('96cfcb96272c895a9dbf7f90', 'YN9b9HCsFuc07FpF');

turnServer.start();

const io = new Server(server, {
  cors: {
    // origin: isProduction ? domain : '*', // Replace with your frontend domain in production
    origin: '*', // Replace with your frontend domain in production
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
let connection: Pool;
const connectionRetryDelay = 5000; // 5000ms delay if the connection fails

const getDbConnection = () => {
  dbPools[testDefaultRoom] = mysql.createPool({
    host: config.DatabaseHost,
    user: config.DatabaseUser,
    password: config.DatabasePassword,
    database: config.DatabaseName,
  });
};

const fetchProximityData = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    dbPools[testDefaultRoom].query('SELECT * FROM ProximityData', (err: any, results: any) => {
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
    // TODO: we could hash the results per room and only emit if the data has changed
    // TODO: we could also filter out players that havent changed (standing still)
    io.volatile.emit('player-positions', results);
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
  roomCode_?: string = undefined;
  maxPlayers_: number = 10;
  joinedPlayers: JoinedPlayers[] = [];

  constructor(roomCode: any, maxPlayers?: any) {
    this.roomCode_ = roomCode;
    this.maxPlayers_ = maxPlayers;
  }
}

const rooms: RoomData[] = [new RoomData('123')];

// interface JoinRoomData{
//   roomCode?: String;
//   steamId?: String;
// }

io.on('connection', (socket: any) => {
  console.log('New user connected: ', socket.id);

  // Handle joining a room
  // TODO: steamId and clientId are the same right now
  socket.on(
    'join-room',
    (token: string, roomCode: any, steamId: any, clientId: any, isHost: any) => {
      //TODO; capacity limits on joining room
      //TODO: to "create a room", lobby host will need to pass in the database connection.
      //TODO: if the db connection fails (doesnt find a table), it won't create new room

      try {
        const payload = jwt.verify(token, jwtSecretKey) as JwtAuthPayload;
        if (!payload.steamId) {
          throw new Error('Invalid steamId');
        }
      } catch (err) {
        //TODO: callback to the client and reset their token
        if (err instanceof jwt.TokenExpiredError) {
          return new Error('Cannot join room: Token has expired');
        } else {
          return new Error('Cannot join room: Invalid token');
        }
      }

      console.log(`joinRoom called with ${roomCode}, ${steamId}`);
      if (!roomCode) return; // If no room is provided, ignore the join attempt.

      const roomExists = rooms.some((room) => room.roomCode_ === roomCode);

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
        })}`,
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
        // Evict player object
        for (const room of rooms) {
          room.joinedPlayers = room.joinedPlayers.filter((player) => player.socketId !== socket.id);
        }
        console.log(`${socket.id} disconnected. Cleaning up.. ${steamId}`);
        socket.to(roomCode).emit('user-left', socket.id, { steamId: steamId, clientId: steamId });
        socket.leave(roomCode); // Remove user from the room when they disconnect
      });
    },
  );
});

server.listen(port, '0.0.0.0', () => {
  if (!isProduction) {
    console.log(`Server running on http://localhost:${port}`);
  } else {
    console.log(`Running server on ${domain}:${port}`);
  }
  getDbConnection();
});
