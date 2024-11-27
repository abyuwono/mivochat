const { Server } = require('socket.io');
const { Server: HttpServer } = require('http');
const { Readable } = require('stream');

// In-memory storage for peer connections
const peers = new Map();
let io = null;
let httpServer = null;

// Create a readable stream from request body
const createBodyStream = (body) => {
    const stream = new Readable();
    stream.push(body);
    stream.push(null);
    return stream;
};

// Create an event emitter-like object
const createEventEmitter = () => {
    const listeners = new Map();
    return {
        on: (event, handler) => {
            if (!listeners.has(event)) {
                listeners.set(event, []);
            }
            listeners.get(event).push(handler);
        },
        emit: (event, ...args) => {
            const eventListeners = listeners.get(event) || [];
            eventListeners.forEach(handler => handler(...args));
        },
        removeListener: (event, handler) => {
            const eventListeners = listeners.get(event) || [];
            const index = eventListeners.indexOf(handler);
            if (index !== -1) {
                eventListeners.splice(index, 1);
            }
        }
    };
};

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
        // Initialize HTTP Server and Socket.IO if not already initialized
        if (!httpServer || !io) {
            httpServer = new HttpServer();
            
            io = new Server(httpServer, {
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
                cookie: false,
                perMessageDeflate: false
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
            return await new Promise((resolve) => {
                // Create response object
                const response = {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Allow-Credentials': 'true',
                        'Cache-Control': 'no-cache'
                    },
                    isBase64Encoded: false
                };

                // Create request-like object
                const req = {
                    method: event.httpMethod,
                    url: event.rawUrl || event.path,
                    headers: {
                        ...event.headers,
                        'content-type': event.headers['content-type'] || 'application/octet-stream',
                        'content-length': event.body ? Buffer.byteLength(event.body) : 0,
                        'x-forwarded-for': event.headers['x-forwarded-for'] || event.requestContext?.identity?.sourceIp || '0.0.0.0'
                    },
                    connection: {
                        remoteAddress: event.headers['x-forwarded-for'] || event.requestContext?.identity?.sourceIp || '0.0.0.0',
                        encrypted: event.headers['x-forwarded-proto'] === 'https'
                    },
                    ...createEventEmitter()
                };

                // Add body stream if needed
                if (event.body) {
                    req.body = event.body;
                    req.bodyStream = createBodyStream(event.body);
                }

                // Create response-like object
                const res = {
                    ...createEventEmitter(),
                    setHeader: (key, value) => {
                        response.headers[key.toLowerCase()] = value;
                    },
                    removeHeader: (key) => {
                        delete response.headers[key.toLowerCase()];
                    },
                    getHeader: (key) => response.headers[key.toLowerCase()],
                    writeHead: (status, headers) => {
                        response.statusCode = status;
                        if (headers) {
                            Object.entries(headers).forEach(([key, value]) => {
                                response.headers[key.toLowerCase()] = value;
                            });
                        }
                    },
                    write: (data) => {
                        if (data) {
                            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
                            if (!response.body) {
                                response.body = chunk.toString('base64');
                            } else {
                                response.body += chunk.toString('base64');
                            }
                            response.isBase64Encoded = true;
                        }
                    },
                    end: (data) => {
                        if (data) {
                            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
                            if (!response.body) {
                                response.body = chunk.toString('base64');
                            } else {
                                response.body += chunk.toString('base64');
                            }
                            response.isBase64Encoded = true;
                        }
                        resolve(response);
                    }
                };

                // Handle the request
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
