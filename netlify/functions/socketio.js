const { Server } = require('socket.io');
const express = require('express');

// Create express app
const app = express();

// In-memory storage for peer connections
const peers = new Map();
let io = null;

// Express middleware for CORS and headers
app.use((req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': 'true',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    next();
});

// Initialize Socket.IO if not already initialized
function initializeSocketIO() {
    if (!io) {
        io = new Server({
            cors: {
                origin: '*',
                methods: ['GET', 'POST', 'OPTIONS'],
                credentials: true
            },
            transports: ['polling'],
            path: '/.netlify/functions/socketio'
        });

        // Socket.IO event handlers
        io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);
            peers.set(socket.id, { busy: false });

            socket.on('find-peer', () => {
                const availablePeers = Array.from(peers.entries())
                    .filter(([id, peer]) => id !== socket.id && !peer.busy);
                
                if (availablePeers.length > 0) {
                    const [peerId, _] = availablePeers[0];
                    const roomId = `room_${Date.now()}`;
                    
                    // Mark both peers as busy
                    peers.set(socket.id, { busy: true, room: roomId });
                    peers.set(peerId, { busy: true, room: roomId });
                    
                    // Join the room
                    socket.join(roomId);
                    io.sockets.sockets.get(peerId)?.join(roomId);
                    
                    // Notify peers
                    socket.emit('peer-found', { isInitiator: true });
                    io.to(peerId).emit('peer-found', { isInitiator: false });
                }
            });

            socket.on('signal', (data) => {
                const peer = peers.get(socket.id);
                if (peer?.room) {
                    socket.to(peer.room).emit('signal', data);
                }
            });

            socket.on('disconnect', () => {
                const peer = peers.get(socket.id);
                if (peer?.room) {
                    socket.to(peer.room).emit('peer-disconnected');
                    // Clean up room
                    const roomPeers = Array.from(peers.entries())
                        .filter(([_, p]) => p.room === peer.room)
                        .map(([id, _]) => id);
                    
                    roomPeers.forEach(id => {
                        peers.delete(id);
                    });
                }
                peers.delete(socket.id);
                console.log('Client disconnected:', socket.id);
            });
        });
    }
    return io;
}

exports.handler = async (event, context) => {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Credentials': 'true',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        };
    }

    try {
        // Initialize Socket.IO
        const io = initializeSocketIO();

        if (event.httpMethod === 'GET' || event.httpMethod === 'POST') {
            // Create request-like object
            const req = {
                method: event.httpMethod,
                url: event.path,
                headers: event.headers,
                query: event.queryStringParameters || {}
            };

            // Create response-like object
            const res = {
                statusCode: 200,
                headers: {},
                body: '',
                setHeader(name, value) {
                    this.headers[name] = value;
                },
                end(data) {
                    this.body = data;
                }
            };

            // Handle Socket.IO request
            await new Promise((resolve, reject) => {
                try {
                    io.engine.handleRequest(req, res);
                    resolve();
                } catch (error) {
                    console.error('Socket.IO error:', error);
                    reject(error);
                }
            });

            return {
                statusCode: res.statusCode,
                headers: {
                    ...res.headers,
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Credentials': 'true',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                body: res.body || ''
            };
        }

        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};
