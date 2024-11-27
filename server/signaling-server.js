const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve index.html for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Track room state
const rooms = new Map();
const MAX_HOSTS = 3;

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    let userId = Math.random().toString(36).substr(2, 9);
    let roomId = 'main-room'; // Using a single room for now
    let isHost = false;

    const broadcastToRoom = (message, excludeUser = null) => {
        const room = rooms.get(roomId);
        if (room) {
            room.connections.forEach((conn) => {
                if (conn.userId !== excludeUser && conn.ws.readyState === WebSocket.OPEN) {
                    conn.ws.send(JSON.stringify(message));
                }
            });
        }
    };

    const sendToUser = (userId, message) => {
        const room = rooms.get(roomId);
        if (room) {
            const conn = room.connections.get(userId);
            if (conn && conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(JSON.stringify(message));
            }
        }
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data.type);
            
            switch (data.type) {
                case 'join-room':
                    console.log('User joining room:', userId);
                    // Initialize room if it doesn't exist
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, {
                            hosts: new Set(),
                            viewers: new Set(),
                            connections: new Map()
                        });
                    }

                    const room = rooms.get(roomId);
                    room.viewers.add(userId);
                    room.connections.set(userId, { ws, userId, isHost: false });

                    // Send current host count to the new viewer
                    ws.send(JSON.stringify({
                        type: 'host-count-update',
                        count: room.hosts.size
                    }));

                    // Notify the viewer they've joined
                    ws.send(JSON.stringify({
                        type: 'room-joined',
                        roomId,
                        userId
                    }));

                    console.log('Room state after join:', {
                        hosts: room.hosts.size,
                        viewers: room.viewers.size
                    });
                    break;

                case 'become-host':
                    console.log('User requesting to become host:', userId);
                    const targetRoom = rooms.get(roomId);
                    if (targetRoom && targetRoom.hosts.size < MAX_HOSTS) {
                        console.log('Host slot available, transitioning user');
                        // Remove from viewers
                        targetRoom.viewers.delete(userId);
                        // Add to hosts
                        targetRoom.hosts.add(userId);
                        isHost = true;
                        
                        const conn = targetRoom.connections.get(userId);
                        if (conn) {
                            conn.isHost = true;
                        }

                        // Notify all clients about the new host count
                        broadcastToRoom({
                            type: 'host-count-update',
                            count: targetRoom.hosts.size
                        });

                        // Confirm host status to the client
                        ws.send(JSON.stringify({
                            type: 'host-status-update',
                            isHost: true,
                            hostCount: targetRoom.hosts.size
                        }));

                        console.log('Room state after host transition:', {
                            hosts: targetRoom.hosts.size,
                            viewers: targetRoom.viewers.size
                        });
                    } else {
                        console.log('Cannot become host: room full or not found');
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Cannot become host: maximum hosts reached'
                        }));
                    }
                    break;

                case 'offer':
                    if (isHost) {
                        console.log('Broadcasting offer from host:', userId);
                        broadcastToRoom({
                            type: 'offer',
                            offer: data.offer,
                            hostId: userId
                        }, userId);
                    }
                    break;

                case 'answer':
                    console.log('Sending answer to host:', data.hostId);
                    sendToUser(data.hostId, {
                        type: 'answer',
                        answer: data.answer,
                        viewerId: userId
                    });
                    break;

                case 'ice-candidate':
                    console.log('Broadcasting ICE candidate');
                    broadcastToRoom({
                        type: 'ice-candidate',
                        candidate: data.candidate,
                        userId: userId,
                        isHost: isHost
                    }, userId);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Connection closed:', userId);
        const room = rooms.get(roomId);
        if (room) {
            if (isHost) {
                room.hosts.delete(userId);
                // Notify remaining clients about host count change
                broadcastToRoom({
                    type: 'host-count-update',
                    count: room.hosts.size
                });
            } else {
                room.viewers.delete(userId);
            }
            room.connections.delete(userId);

            console.log('Room state after disconnect:', {
                hosts: room.hosts.size,
                viewers: room.viewers.size
            });

            // Clean up empty rooms
            if (room.hosts.size === 0 && room.viewers.size === 0) {
                rooms.delete(roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
