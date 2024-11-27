const { Server } = require('socket.io');
const express = require('express');
const { createServer } = require('http');

// Create express app
const app = express();

// Create HTTP server
const httpServer = createServer(app);

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
        io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST', 'OPTIONS'],
                credentials: true
            },
            transports: ['polling'],
            path: '/.netlify/functions/socketio',
            serveClient: false,
            pingTimeout: 10000,
            pingInterval: 5000,
            connectTimeout: 45000,
            allowEIO3: true
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

// Socket.IO handler function
function handleSocketRequest(req, res) {
    return new Promise((resolve, reject) => {
        try {
            const io = initializeSocketIO();
            
            // Create a fake upgrade event
            const upgradeEvent = {
                req: req,
                socket: {
                    setTimeout: () => {},
                    setNoDelay: () => {},
                    setKeepAlive: () => {}
                },
                head: Buffer.alloc(0)
            };

            // Handle the Socket.IO request
            io.engine.handleRequest(req, res);
            
            // Handle potential WebSocket upgrade
            if (req.headers['upgrade'] === 'websocket') {
                io.engine.handleUpgrade(upgradeEvent);
            }
            
            resolve();
        } catch (error) {
            console.error('Socket.IO error:', error);
            reject(error);
        }
    });
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
        if (event.httpMethod === 'GET' || event.httpMethod === 'POST') {
            // Create request-like object
            const req = {
                method: event.httpMethod,
                url: event.path,
                headers: event.headers,
                query: event.queryStringParameters || {},
                connection: {
                    remoteAddress: event.requestContext?.identity?.sourceIp || '0.0.0.0'
                }
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
            await handleSocketRequest(req, res);

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
