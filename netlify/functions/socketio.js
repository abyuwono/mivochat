const { Server } = require('socket.io');
const serverless = require('serverless-http');
const express = require('express');
const { uniqueNamesGenerator, colors, animals } = require('unique-names-generator');

const app = express();
const io = new Server({
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true
    },
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

// Room management
const rooms = new Map();
const userToRoom = new Map();
const users = new Map();
let waitingUsers = [];

// Generate nickname for a user
function generateNickname() {
    return uniqueNamesGenerator({
        dictionaries: [colors, animals],
        separator: '',
        length: 2,
        style: 'capital'
    });
}

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    const nickname = generateNickname();
    users.set(socket.id, { nickname });
    socket.emit('nickname', nickname);

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        handleDisconnect(socket);
    });

    socket.on('find-peer', () => {
        console.log('Finding peer for:', socket.id);
        handleFindPeer(socket, io);
    });

    socket.on('signal', (data) => {
        handleSignal(socket, data, io);
    });

    socket.on('join-public-room', () => {
        console.log('Joining public room:', socket.id);
        handleJoinPublicRoom(socket, io);
    });

    socket.on('message', (data) => {
        handleMessage(socket, data, io);
    });

    socket.on('public-message', (data) => {
        handlePublicMessage(socket, data, io);
    });
});

// Helper functions
function handleDisconnect(socket) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            room.users = room.users.filter(id => id !== socket.id);
            if (room.users.length === 0) {
                rooms.delete(roomId);
            } else {
                rooms.set(roomId, room);
                io.to(roomId).emit('peer-disconnected');
            }
        }
    }
    users.delete(socket.id);
    userToRoom.delete(socket.id);
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
}

function handleFindPeer(socket, io) {
    if (waitingUsers.length > 0 && waitingUsers[0] !== socket.id) {
        const peerId = waitingUsers.shift();
        const roomId = generateRoomId();
        
        rooms.set(roomId, { users: [socket.id, peerId], messages: [] });
        userToRoom.set(socket.id, roomId);
        userToRoom.set(peerId, roomId);
        
        socket.join(roomId);
        io.sockets.sockets.get(peerId)?.join(roomId);
        
        io.to(roomId).emit('room-joined', { roomId });
        io.to(peerId).emit('peer-found', { isInitiator: true });
        socket.emit('peer-found', { isInitiator: false });
    } else {
        waitingUsers.push(socket.id);
    }
}

function handleSignal(socket, data, io) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        socket.to(roomId).emit('signal', data);
    }
}

function handleJoinPublicRoom(socket, io) {
    const publicRoomId = 'public';
    socket.join(publicRoomId);
    const room = rooms.get(publicRoomId) || { users: [], messages: [] };
    room.users.push(socket.id);
    rooms.set(publicRoomId, room);
    userToRoom.set(socket.id, publicRoomId);
    
    socket.emit('public-room-joined', {
        roomId: publicRoomId,
        name: 'Public Chat',
        userCount: room.users.length,
        recentMessages: room.messages.slice(-10),
        nickname: users.get(socket.id)?.nickname
    });
    
    socket.to(publicRoomId).emit('user-count-changed', { count: room.users.length });
}

function handleMessage(socket, { text }, io) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const nickname = users.get(socket.id)?.nickname;
        socket.to(roomId).emit('message', { text, sender: nickname });
    }
}

function handlePublicMessage(socket, { text }, io) {
    const roomId = userToRoom.get(socket.id);
    if (roomId === 'public') {
        const nickname = users.get(socket.id)?.nickname;
        const message = { text, sender: nickname, timestamp: Date.now() };
        const room = rooms.get(roomId);
        if (room) {
            room.messages.push(message);
            if (room.messages.length > 100) room.messages.shift();
            io.to(roomId).emit('public-message', message);
        }
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 15);
}

// Express middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});

// Socket.IO handler
app.post('/', (req, res) => {
    io.handleUpgrade(req, req.socket, Buffer.alloc(0));
    res.status(200).json({ status: 'ok' });
});

// Export the serverless handler
exports.handler = serverless(app);
