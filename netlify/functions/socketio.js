const { Server } = require('socket.io');
const express = require('express');
const serverless = require('serverless-http');

const app = express();

// Room management
const rooms = new Map();
const userToRoom = new Map();
const users = new Map();
let waitingUsers = [];

// Socket.IO setup
const io = new Server({
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true,
        allowedHeaders: ['*']
    },
    transports: ['polling'],
    allowEIO3: true,
    pingTimeout: 10000,
    pingInterval: 5000
});

// Express middleware
app.use(express.json());
app.use((req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Cache-Control': 'no-cache'
    });

    if (req.method === 'OPTIONS') {
        res.status(204).send();
        return;
    }

    next();
});

// Socket.IO event handlers
io.on('connection', (socket) => {
    console.log('New connection:', socket.id);
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomId = userToRoom.get(socket.id);
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                room.users = room.users.filter(id => id !== socket.id);
                if (room.users.length === 0) {
                    rooms.delete(roomId);
                } else {
                    socket.to(roomId).emit('peer-disconnected');
                }
            }
        }
        users.delete(socket.id);
        userToRoom.delete(socket.id);
        waitingUsers = waitingUsers.filter(id => id !== socket.id);
    });

    socket.on('find-peer', () => {
        if (waitingUsers.length > 0 && waitingUsers[0] !== socket.id) {
            const peerId = waitingUsers.shift();
            const roomId = Math.random().toString(36).substring(2, 15);
            
            rooms.set(roomId, { users: [socket.id, peerId] });
            userToRoom.set(socket.id, roomId);
            userToRoom.set(peerId, roomId);
            
            socket.join(roomId);
            io.sockets.sockets.get(peerId)?.join(roomId);
            
            io.to(peerId).emit('peer-found', { isInitiator: true });
            socket.emit('peer-found', { isInitiator: false });
        } else if (!waitingUsers.includes(socket.id)) {
            waitingUsers.push(socket.id);
        }
    });

    socket.on('signal', (data) => {
        const roomId = userToRoom.get(socket.id);
        if (roomId) {
            socket.to(roomId).emit('signal', data);
        }
    });
});

// Socket.IO handler
app.use('/.netlify/functions/socketio', (req, res) => {
    if (req.method === 'GET') {
        io.handleRequest(req, res);
    } else if (req.method === 'POST') {
        io.handleUpgrade(req, req.socket, Buffer.alloc(0));
        res.status(200).json({ status: 'ok' });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Export the serverless handler
const handler = serverless(app);
exports.handler = async (event, context) => {
    // Return immediately for preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Credentials': 'true',
                'Cache-Control': 'no-cache'
            }
        };
    }

    try {
        const result = await handler(event, context);
        return result;
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
