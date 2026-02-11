const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');
const Game = require('./src/game');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Game Rooms Store
// Map<roomId, GameInstance>
const rooms = new Map();
const activeUsernames = new Set(); // Stores lowercase usernames
let roomCounter = 1;

function getPublicRooms() {
    return Array.from(rooms.values())
        .filter(game => game.state === 'waiting')
        .map(game => ({ id: game.roomId, playerCount: game.players.length }));
}

io.on('connection', (socket) => {
    socket.on('disconnect', () => {
        const username = socket.data.username;
        if (username) {
            activeUsernames.delete(username.toLowerCase());
        }

        const roomId = socket.data.roomId;
        if (roomId) {
            const game = rooms.get(roomId);
            if (game) {
                game.removePlayer(socket.id);
                if (game.players.length === 0) {
                    rooms.delete(roomId);
                } else {
                    io.to(roomId).emit('game_update', game.getPublicState());
                    io.to(roomId).emit('game_log', { type: 'info', message: `${username} se ha desconectado` });
                }
                // Update global lobby room list
                io.emit('room_list', getPublicRooms());
            }
        }
    });

    socket.on('join_lobby', ({ username, userId }) => {
        console.log(`${userId}(${username}) se ha unido al lobby`);
        const lowerName = username.toLowerCase();
        if (activeUsernames.has(lowerName)) {
            socket.emit('error', 'Nombre de usuario ya registrado');
            return;
        }
        activeUsernames.add(lowerName);

        // Just for acknowledging the user is "ready"
        socket.data.username = username;
        socket.data.userId = userId;
        socket.emit('lobby_joined');
        // Send current available rooms
        socket.emit('room_list', getPublicRooms());
    });

    socket.on('update_username', (newUsername) => {
        const oldUsername = socket.data.username;
        if (!oldUsername) return;

        // Validation
        if (!newUsername || newUsername.length < 3 || newUsername.length > 12) {
            socket.emit('error', 'El nombre de usuario debe tener entre 3 y 12 caracteres.');
            return;
        }
        if (/\s/.test(newUsername)) {
            socket.emit('error', 'El nombre de usuario no puede contener espacios.');
            return;
        }

        const lowerNew = newUsername.toLowerCase();
        const lowerOld = oldUsername.toLowerCase();

        if (lowerNew !== lowerOld && activeUsernames.has(lowerNew)) {
            socket.emit('error', 'Nombre de usuario ya registrado');
            return;
        }

        // Update active usernames
        activeUsernames.delete(lowerOld);
        activeUsernames.add(lowerNew);

        // Update socket data
        socket.data.username = newUsername;

        // Update any games the user is in
        rooms.forEach(game => {
            const player = game.players.find(p => p.id === socket.data.userId);
            if (player) {
                player.username = newUsername;
                io.to(game.roomId).emit('game_update', game.getPublicState());
            }
        });
        console.log(`${oldUsername} ha cambiado su nombre de usuario a ${newUsername}`);

        socket.emit('username_updated', newUsername);
    });

    socket.on('create_room', () => {
        const roomName = `Sala #${roomCounter++}`;
        const newGame = new Game(roomName);
        newGame.hostUserId = socket.data.userId; // Set the persistent host by ID
        rooms.set(roomName, newGame);

        socket.join(roomName);
        socket.data.roomId = roomName; // Track current room
        newGame.addPlayer(socket.data.userId, socket.data.username);

        socket.emit('room_joined', { roomId: roomName, isCreator: true });
        io.emit('room_list', getPublicRooms());

        io.to(roomName).emit('game_update', newGame.getPublicState());
    });

    socket.on('join_room', (roomId) => {
        const game = rooms.get(roomId);
        if (!game) {
            socket.emit('error', 'Sala no encontrada');
            return;
        }

        // Reconnection check: if already in players, we allow joining even if started
        const isActuallyCreator = game.hostUserId === socket.data.userId;
        const isReconnecting = game.players.some(p => p.id === socket.data.userId);

        if (game.state !== 'waiting' && !isReconnecting) {
            socket.emit('error', 'Juego ya iniciado');
            return;
        }
        if (game.players.length >= 10 && !isReconnecting) {
            socket.emit('error', 'Sala llena');
            return;
        }

        socket.join(roomId);
        socket.data.roomId = roomId; // Track current room

        game.addPlayer(socket.data.userId, socket.data.username);

        socket.emit('room_joined', { roomId: roomId, isCreator: isActuallyCreator });

        io.to(roomId).emit('game_update', game.getPublicState());

        // Update lobby list
        io.emit('room_list', getPublicRooms());
    });

    socket.on('start_game', (roomId) => {
        const game = rooms.get(roomId);
        if (game && game.hostUserId === socket.data.userId) { // Restricted to host
            game.startGame();
            io.to(roomId).emit('game_started');
            io.to(roomId).emit('game_update', game.getPublicState());
        }
    });

    socket.on('restart_game', (roomId) => {
        const game = rooms.get(roomId);
        if (game && game.hostUserId === socket.data.userId) { // Restricted to host
            game.startGame(); // Re-runs start logic, shuffling, etc.
            io.to(roomId).emit('game_started');
            io.to(roomId).emit('game_update', game.getPublicState());
            io.to(roomId).emit('game_log', { type: 'info', message: 'Juego reiniciado por el anfitrión' });
        }
    });

    socket.on('end_session', (roomId) => {
        const game = rooms.get(roomId);
        if (game && game.hostUserId === socket.data.userId) { // Restricted to host
            // Delete the room
            rooms.delete(roomId);

            // Notify all players in room to return to lobby
            io.to(roomId).emit('room_terminated');

            // Update the global room list
            io.emit('room_list', Array.from(rooms.values())
                .filter(g => g.state === 'waiting')
                .map(g => ({ id: g.roomId, playerCount: g.players.length })));
        }
    });

    socket.on('game_action', ({ roomId, action, data }) => {
        const game = rooms.get(roomId);
        if (game) {
            try {
                const result = game.handleAction(socket.data.userId, action, data);
                io.to(roomId).emit('game_update', game.getPublicState());

                if (result && result.log) {
                    io.to(roomId).emit('game_log', result.log);
                }
            } catch (e) {
                socket.emit('error', e.message);
            }
        }
    });

});

const port = process.env.PORT || 42073;
server.listen(port, () => {
    console.log(`listening on *:${port}`);
});
