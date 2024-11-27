const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { uniqueNamesGenerator, adjectives, colors, animals } = require('unique-names-generator');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: [
            "http://localhost:3000",
            "https://mivocom.netlify.app",
            "https://mivochat-production.up.railway.app"
        ],
        methods: ["GET", "POST"],
        credentials: true,
        allowedHeaders: ["*"]
    },
    transports: ['websocket', 'polling']
});

// Enable CORS for Express routes
app.use(cors({
    origin: [
        "http://localhost:3000",
        "https://mivocom.netlify.app",
        "https://mivochat-production.up.railway.app"
    ],
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["*"]
}));

// Store connected peers
const peers = new Map();

// Generate random nickname
const generateNickname = () => {
    return uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        separator: '',
        style: 'capital'
    });
};

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    peers.set(socket.id, { busy: false });

    // Generate and store nickname for the user
    const nickname = generateNickname();
    socket.nickname = nickname;
    
    socket.emit('nickname', nickname);

    // Handle find peer request
    socket.on('find-peer', () => {
        const availablePeers = Array.from(peers.entries())
            .filter(([id, peer]) => id !== socket.id && !peer.busy);
        
        if (availablePeers.length > 0) {
            const [peerId, _] = availablePeers[0];
            const roomId = `room_${Date.now()}`;
            
            peers.set(socket.id, { busy: true, room: roomId });
            peers.set(peerId, { busy: true, room: roomId });
            
            socket.join(roomId);
            io.sockets.sockets.get(peerId)?.join(roomId);
            
            socket.emit('peer-found', { 
                isInitiator: true,
                peerNickname: io.sockets.sockets.get(peerId)?.nickname || 'Anonymous'
            });
            io.to(peerId).emit('peer-found', { 
                isInitiator: false,
                peerNickname: socket.nickname
            });
        }
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const peer = peers.get(socket.id);
        if (peer?.room) {
            socket.to(peer.room).emit('signal', data);
        }
    });

    // Handle chat message
    socket.on('send-message', (message) => {
        const peer = peers.get(socket.id);
        if (peer?.room) {
            socket.to(peer.room).emit('receive-message', {
                message,
                nickname: socket.nickname || 'Anonymous'
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const peer = peers.get(socket.id);
        
        if (peer?.room) {
            socket.to(peer.room).emit('peer-disconnected');
            // Free up peers in the room
            for (const [id, p] of peers.entries()) {
                if (p.room === peer.room) {
                    peers.set(id, { busy: false });
                }
            }
        }
        peers.delete(socket.id);
    });
});

// Basic health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        connections: peers.size,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Socket.IO server running on port ${PORT}`);
});
