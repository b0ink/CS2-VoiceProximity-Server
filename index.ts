const express = require("express");
const { Server } = require("socket.io");
const app = express();

const io = new Server(3000, { cors: { origin: "*" } });

const config = require("./db.json");

const mysql = require("mysql2");

let connection: any;

const setDbConnection = () => {
    connection = mysql.createPool({
        host: config.DatabaseHost,
        user: config.DatabaseUser,
        password: config.DatabasePassword,
        database: config.DatabaseName,
    });
};

// Query the database and send the results to connected users
const queryDatabaseAndUpdatePlayers = () => {
    if (!connection || connection.state == "disconnected") {
        console.log("not connected");
        return;
    }
    connection.query("SELECT * FROM ProximityData", (err: any, results: any) => {
        if (err) {
            console.error("Error fetching player positions:", err);
            return;
        }

        // console.log(results)

        // Send player position data to all connected clients
        io.emit("player-positions", results);
    });
};

// Run the database query every 0.1 seconds (100ms)
setInterval(queryDatabaseAndUpdatePlayers, 50);
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

const rooms: any[] = [new RoomData("123")];

// interface JoinRoomData{
//   roomCode?: String;
//   steamId?: String;
// }

io.on("connection", (socket: any) => {
    console.log("New user connected: ", socket.id);

    // Handle joining a room
    // TODO: steamId and clientId are the same right now
    socket.on("join-room", (roomCode: any, steamId: any, clientId: any, isHost: any) => {
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
            console.log("room doesnt exist, notify the user to try again!");
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
        socket.to(roomCode).emit("user-joined", socket.id, { steamId: steamId, clientId: steamId });

        // Handle signaling (peer-to-peer connections)
        socket.on("signal", ({ to, data }: any) => {
            io.to(to).emit("signal", {
                from: socket.id,
                data,
                client: { steamId: steamId, clientId: steamId },
            });
        });

        //TODO: handle a manual 'leave' event, removing their data from their joined room

        // Handle user disconnection
        socket.on("disconnect", () => {
            //TODO: remove them from the joinedPLayers array
            console.log(`${socket.id} disconnected`);
            socket.to(roomCode).emit("user-left", socket.id);
            socket.leave(roomCode); // Remove user from the room when they disconnect
        });
    });
});

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
    setDbConnection();
});
