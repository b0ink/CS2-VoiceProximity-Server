import { Server } from 'socket.io';
import http from 'http';
import mysql, { Pool } from 'mysql2';
import dotenv from 'dotenv';
import { JwtAuthPayload, SteamOpenIDParams } from './types';
import jwt from 'jsonwebtoken';
import TurnServer from 'node-turn';

dotenv.config({ path: '../.env' });

// let TurnServer :TurnServer = require('node-turn');

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
      // exp: Math.floor(Date.now() / 1000) + 1,
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
const externalIp = process.env.EXTERNAL_IP;
const listeningIps = process.env.LISTENING_IPS?.split(',');

if (!relayIps || relayIps?.length === 0) {
  throw new Error('Invalid relay ips list');
}

if (!listeningIps || listeningIps?.length === 0) {
  throw new Error('Invalid relay ips list');
}

if (!externalIp) {
  throw new Error('Invalid external ip');
}

console.log(relayIps);
console.log(listeningIps);
console.log(externalIp);

let turnServer = new TurnServer({
  listeningIps: listeningIps,
  relayIps: relayIps || [],
  externalIps: externalIp,
  minPort: 49152,
  maxPort: 65535,
  listeningPort: 3478,
  authMech: 'long-term',
  debugLevel: !isProduction ? 'ALL' : 'INFO',
  realm: 'cs2voiceproximity',
});

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
  socketId: string | null = null;
  steamId: string | null = null;
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
    (
      data: { token: string; roomCode: string; steamId: string; clientId: string; isHost: any },
      callback: any,
    ) => {
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
        // TODO: "reject" the attempt so that the user is notified this room doesnt exist
        // callback({ error: "Room doesn't exist" });
        console.log('room doesnt exist, notify the user to try again!');
        return callback({ success: false, message: 'Room does not exist' });
      }

      let newPlayer = new JoinedPlayers();
      newPlayer.socketId = socket.id;
      newPlayer.steamId = data.steamId;
      rooms[0].joinedPlayers.push(newPlayer);

      socket.join(data.roomCode);
      console.log(`${socket.id} joined room: ${data.roomCode} with steamid ${data.steamId}`);

      // callback({ success: "joined room" });

      // Notify other users in the room about the new user joining
      callback({ success: true, message: 'Joining room' });

      console.log(
        `calling user-joined with ${socket.id} ${JSON.stringify({
          steamId: data.steamId,
          clientId: data.steamId,
        })}`,
      );
      socket
        .to(data.roomCode)
        .emit('user-joined', socket.id, { steamId: data.steamId, clientId: data.steamId });

      // Handle signaling (peer-to-peer connections)
      socket.on('signal', ({ to, data }: any) => {
        io.to(to).emit('signal', {
          from: socket.id,
          data,
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
    },
  );
});

server.listen(port, () => {
  if (!isProduction) {
    console.log(`Server running on http://localhost:${port}`);
  } else {
    console.log(`Running server on ${domain}:${port}`);
  }
  getDbConnection();
});
