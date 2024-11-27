const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { uniqueNamesGenerator, adjectives, colors, animals } = require('unique-names-generator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, '/')));
app.use(express.json());

// Cloudflare configuration
const CLOUDFLARE_ACCOUNT_ID = 'f515e268b7a98324a18a2d5240534c4b';
const CLOUDFLARE_API_TOKEN = 'Y5tMp-nyKRczoBkD5iwi9dxpb0P6cSRmbiJ1XoSx';
const CLOUDFLARE_API_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/stream`;

// Create a new WebRTC stream
app.post('/api/create-stream', async (req, res) => {
    console.log('Creating new stream...');
    try {
        const response = await fetch(`${CLOUDFLARE_API_BASE}/live_inputs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                meta: { name: `Stream_${Date.now()}` },
                recording: { mode: "automatic" }
            })
        });

        const data = await response.json();
        console.log('Stream creation response:', data);

        if (!data.success) {
            console.error('Stream creation failed:', data.errors);
            throw new Error(data.errors[0].message);
        }

        res.json({
            streamKey: data.result.uid,
            rtmps: data.result.rtmps,
            webRTC: data.result.webRTC,
        });
    } catch (error) {
        console.error('Error creating stream:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get stream status
app.get('/api/stream/:streamId', async (req, res) => {
    console.log('Getting stream status for:', req.params.streamId);
    try {
        const response = await fetch(`${CLOUDFLARE_API_BASE}/live_inputs/${req.params.streamId}`, {
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`
            }
        });

        const data = await response.json();
        console.log('Stream status response:', data);

        if (!data.success) {
            console.error('Stream status check failed:', data.errors);
            throw new Error(data.errors[0].message);
        }

        res.json(data.result);
    } catch (error) {
        console.error('Error getting stream status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Room management
const rooms = new Map(); // roomId -> { users: [socketId], messages: [] }
const userToRoom = new Map(); // socketId -> roomId
const publicRooms = new Map(); // roomId -> { name: string, users: [socketId], messages: [] }
const users = new Map(); // socketId -> { nickname }

// Customize the name generator config for shorter names
const nameConfig = {
    dictionaries: [colors, animals],
    separator: '',
    length: 2,
    style: 'capital'
};

// Generate nickname for a user
function generateNickname() {
    return uniqueNamesGenerator(nameConfig);
}

// Create default public room
const DEFAULT_ROOM = 'public-chat';
publicRooms.set(DEFAULT_ROOM, {
    name: 'Public Chat Room',
    users: [],
    messages: [],
    maxUsers: 50 // Maximum users in public room
});

// Queue for waiting users
let waitingUsers = [];

io.on('connection', (socket) => {
    // Generate and store nickname for the user
    const nickname = generateNickname();
    users.set(socket.id, { nickname });
    
    console.log(`User connected: ${socket.id} (${nickname})`);

    // Join public room
    socket.on('join-public-room', () => {
        const publicRoom = publicRooms.get(DEFAULT_ROOM);
        if (publicRoom) {
            // Leave any existing room
            const currentRoom = userToRoom.get(socket.id);
            if (currentRoom) {
                socket.leave(currentRoom);
                const room = rooms.get(currentRoom);
                if (room) {
                    room.users = room.users.filter(id => id !== socket.id);
                    if (room.users.length === 0) {
                        rooms.delete(currentRoom);
                    }
                }
            }

            // Join public room
            socket.join(DEFAULT_ROOM);
            publicRoom.users.push(socket.id);
            userToRoom.set(socket.id, DEFAULT_ROOM);

            // Send room info and recent messages
            socket.emit('public-room-joined', {
                roomId: DEFAULT_ROOM,
                name: publicRoom.name,
                userCount: publicRoom.users.length,
                recentMessages: publicRoom.messages.slice(-50), // Send last 50 messages
                nickname: users.get(socket.id).nickname
            });

            // Notify all users in public room
            io.to(DEFAULT_ROOM).emit('user-count-updated', {
                userCount: publicRoom.users.length
            });
        }
    });

    // Handle find peer request
    socket.on('find-peer', () => {
        console.log('User looking for peer:', socket.id);

        if (waitingUsers.length > 0) {
            const peer = waitingUsers.shift();
            const roomId = Date.now().toString();
            
            console.log('Creating room:', roomId, 'for users:', socket.id, peer);
            
            // Create new room
            rooms.set(roomId, {
                users: [socket.id, peer],
                messages: []
            });
            
            // Map users to room
            userToRoom.set(socket.id, roomId);
            userToRoom.set(peer, roomId);
            
            // Join socket room
            socket.join(roomId);
            io.sockets.sockets.get(peer)?.join(roomId);
            
            // Notify both peers
            io.to(roomId).emit('room-joined', { roomId });
            io.to(peer).emit('peer-found', { initiator: false });
            socket.emit('peer-found', { initiator: true });
        } else {
            console.log('No peers available, adding to waiting queue:', socket.id);
            waitingUsers.push(socket.id);
        }
    });

    // Handle WebRTC signaling
    socket.on('signal', (data) => {
        const roomId = userToRoom.get(socket.id);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        const peer = room.users.find(id => id !== socket.id);
        if (!peer) return;

        console.log('Sending signal from', socket.id, 'to', peer);
        io.to(peer).emit('signal', data);
    });

    // Handle chat message
    socket.on('send-message', (message) => {
        const room = [...socket.rooms].find(room => room !== socket.id);
        if (room) {
            // Only emit to the peer, not back to sender
            socket.to(room).emit('receive-message', {
                message,
                nickname: users.get(socket.id)?.nickname || 'Anonymous'
            });
        }
    });

    // Handle disconnection
    const handleDisconnect = () => {
        console.log('User disconnected:', socket.id);
        
        // Remove from waiting queue
        const waitingIndex = waitingUsers.indexOf(socket.id);
        if (waitingIndex !== -1) {
            waitingUsers.splice(waitingIndex, 1);
        }

        // Handle room cleanup
        const roomId = userToRoom.get(socket.id);
        if (roomId) {
            if (roomId === DEFAULT_ROOM) {
                // Handle public room disconnect
                const publicRoom = publicRooms.get(DEFAULT_ROOM);
                if (publicRoom) {
                    publicRoom.users = publicRoom.users.filter(id => id !== socket.id);
                    io.to(DEFAULT_ROOM).emit('user-count-updated', {
                        userCount: publicRoom.users.length
                    });
                }
            } else {
                // Handle private room disconnect
                const room = rooms.get(roomId);
                if (room) {
                    const peer = room.users.find(id => id !== socket.id);
                    if (peer) {
                        io.to(peer).emit('peer-disconnected');
                        userToRoom.delete(peer);
                    }
                    rooms.delete(roomId);
                }
            }
            userToRoom.delete(socket.id);
        }
        users.delete(socket.id);
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('leave-room', handleDisconnect);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
