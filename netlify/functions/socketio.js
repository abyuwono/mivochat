const { Server } = require('socket.io');

// In-memory storage for peer connections
const peers = new Map();
let io = null;

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

// Create a response-like object that Socket.IO expects
function createResponse(resolve) {
    let headers = {};
    let statusCode = 200;
    let body = '';

    return {
        writeHead(status, headers_) {
            statusCode = status;
            if (headers_) {
                headers = { ...headers, ...headers_ };
            }
            return this;
        },
        setHeader(key, value) {
            headers[key] = value;
            return this;
        },
        write(data) {
            body += data;
            return this;
        },
        end(data) {
            if (data) {
                body += data;
            }
            resolve({
                statusCode,
                headers,
                body
            });
        }
    };
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
            const io = initializeSocketIO();

            // Create request-like object
            const req = {
                method: event.httpMethod,
                url: event.path,
                headers: event.headers || {},
                connection: {
                    remoteAddress: event.requestContext?.identity?.sourceIp || '0.0.0.0'
                }
            };

            // Handle the Socket.IO request
            const response = await new Promise((resolve) => {
                const res = createResponse(resolve);
                io.engine.handleRequest(req, res);
            });

            return {
                ...response,
                headers: {
                    ...response.headers,
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

        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
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
