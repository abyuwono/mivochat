const { Server } = require('socket.io');
const { parse } = require('querystring');

// In-memory storage for peer connections and sessions
const peers = new Map();
const sessions = new Map();
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
                allowUpgrades: true,
                pingTimeout: 20000,
                pingInterval: 25000,
                upgradeTimeout: 10000,
                maxHttpBufferSize: 1e8
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

        // Parse query parameters
        const queryParams = event.queryStringParameters || {};
        const sid = queryParams.sid;
        const transport = queryParams.transport;

        // Handle Socket.IO requests
        if (event.path.startsWith('/socket.io/')) {
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

            // Handle POST data for polling transport
            if (event.httpMethod === 'POST' && transport === 'polling') {
                const data = event.body || '';
                const session = sessions.get(sid);

                if (session) {
                    session.emit('data', data);
                    session.emit('end');
                    response.body = 'ok';
                } else {
                    response.statusCode = 400;
                    response.body = 'Session not found';
                }

                return response;
            }

            // Handle GET requests for polling transport
            if (event.httpMethod === 'GET' && transport === 'polling') {
                if (!sid) {
                    // New connection, create session
                    const sessionId = Math.random().toString(36).substr(2, 8);
                    sessions.set(sessionId, {
                        created: Date.now(),
                        lastAccess: Date.now()
                    });
                    response.body = `96:0{"sid":"${sessionId}","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000}2:40`;
                } else {
                    // Existing session
                    const session = sessions.get(sid);
                    if (session) {
                        session.lastAccess = Date.now();
                        response.body = '6:3probe';
                    } else {
                        response.statusCode = 400;
                        response.body = 'Invalid session';
                    }
                }

                return response;
            }

            // Handle WebSocket upgrade
            if (transport === 'websocket') {
                return {
                    statusCode: 400,
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: 'WebSocket not supported in polling mode'
                };
            }

            // Default Socket.IO response
            return await new Promise((resolve) => {
                io.engine.handleRequest(
                    {
                        method: event.httpMethod,
                        url: event.path,
                        headers: event.headers,
                        query: queryParams,
                        body: event.body
                    },
                    {
                        setHeader: (key, value) => {
                            response.headers[key] = value;
                        },
                        writeHead: (status, headers) => {
                            response.statusCode = status;
                            if (headers) {
                                response.headers = { ...response.headers, ...headers };
                            }
                        },
                        end: (data) => {
                            if (data) {
                                response.body = data;
                            }
                            resolve(response);
                        }
                    }
                );
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
                connections: peers.size || 0
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
                message: error.message
            })
        };
    }
};
