const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { uniqueNamesGenerator, adjectives, colors, animals } = require('unique-names-generator');
require('dotenv').config();

const app = express();

// Define allowed origins
const allowedOrigins = [
    'http://localhost:3000',
    'https://mivocom.netlify.app',
    'https://mivochat-production.up.railway.app'
];

// Configure CORS middleware
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true,
    optionsSuccessStatus: 204
}));

app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

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

// API Routes
const apiRouter = express.Router();

// Get ICE servers configuration
apiRouter.get('/ice-servers', (req, res) => {
    res.json({
        iceServers: [
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302'
                ]
            }
        ]
    });
});

// Get active users count
apiRouter.get('/users/count', (req, res) => {
    res.json({ count: peers.size });
});

// Mount API routes
app.use('/api', apiRouter);

// Basic health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        connections: peers.size,
        uptime: process.uptime()
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    peers.set(socket.id, { busy: false });

    // Broadcast updated user count
    io.emit('user-count-updated', { userCount: peers.size });

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
                peerNickname: io.sockets.sockets.get(peerId)?.nickname || 'Anonymous',
                roomId: roomId
            });
            io.to(peerId).emit('peer-found', { 
                isInitiator: false,
                peerNickname: socket.nickname,
                roomId: roomId
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
            socket.to(peer.room).emit('message', {
                sender: socket.id,
                text: message,
                timestamp: Date.now(),
                nickname: socket.nickname
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
        
        // Broadcast updated user count
        io.emit('user-count-updated', { userCount: peers.size });
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
