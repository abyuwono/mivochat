const { Server } = require('socket.io');
const { parse } = require('url');

// In-memory storage for peer connections
const peers = new Map();
let io = null;

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
                'Cache-Control': 'no-cache'
            }
        };
    }

    try {
        // Initialize Socket.IO if not already initialized
        if (!io) {
            io = new Server({
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST', 'OPTIONS'],
                    credentials: true
                },
                transports: ['polling', 'websocket'],
                path: '/socket.io/',
                serveClient: false,
                connectTimeout: 45000,
                pingTimeout: 20000,
                pingInterval: 25000,
                allowEIO3: true,
                cookie: false
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
                        
                        peers.set(socket.id, { busy: true, room: roomId });
                        peers.set(peerId, { busy: true, room: roomId });
                        
                        socket.join(roomId);
                        io.sockets.sockets.get(peerId)?.join(roomId);
                        
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

        // Handle Socket.IO requests
        const isSocketIoRequest = event.path.startsWith('/socket.io/');
        
        if (isSocketIoRequest) {
            const { pathname, query } = parse(event.path, true);

            return await new Promise((resolve) => {
                const response = {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Allow-Credentials': 'true',
                        'Cache-Control': 'no-cache'
                    }
                };

                const req = {
                    method: event.httpMethod,
                    url: event.path,
                    headers: {
                        ...event.headers,
                        'x-forwarded-for': event.headers['x-forwarded-for'] || event.requestContext?.identity?.sourceIp || '0.0.0.0',
                        'x-real-ip': event.headers['x-real-ip'] || event.requestContext?.identity?.sourceIp || '0.0.0.0'
                    },
                    connection: {
                        remoteAddress: event.headers['x-forwarded-for'] || event.requestContext?.identity?.sourceIp || '0.0.0.0',
                        encrypted: event.headers['x-forwarded-proto'] === 'https'
                    }
                };

                const res = {
                    setHeader: (key, value) => {
                        response.headers[key] = value;
                    },
                    removeHeader: () => {},
                    getHeader: () => {},
                    writeHead: (status, headers) => {
                        response.statusCode = status;
                        if (headers) {
                            response.headers = { ...response.headers, ...headers };
                        }
                    },
                    write: (data) => {
                        if (data) {
                            response.body = Buffer.from(data).toString('base64');
                            response.isBase64Encoded = true;
                        }
                    },
                    end: (data) => {
                        if (data) {
                            response.body = Buffer.from(data).toString('base64');
                            response.isBase64Encoded = true;
                        }
                        resolve(response);
                    }
                };

                io.engine.handleRequest(req, res);
            });
        }

        // Default response for non-Socket.IO requests
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                status: 'ok',
                connections: peers.size
            })
        };
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};
