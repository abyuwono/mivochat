const { Server } = require('socket.io');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

// In-memory storage for peer connections
const peers = new Map();
let io = null;

// Create a proper request object with all required properties
function createRequestObject(event) {
    const remoteAddress = event.headers['x-forwarded-for'] || 
                         event.headers['x-real-ip'] || 
                         event.requestContext?.identity?.sourceIp || 
                         '0.0.0.0';

    const req = new EventEmitter();
    
    // Add required properties
    req.method = event.httpMethod;
    req.url = event.path + (event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : '');
    req.headers = {
        ...event.headers,
        'content-type': event.headers['content-type'] || 'application/octet-stream',
        'content-length': event.body ? Buffer.byteLength(event.body) : 0
    };
    req.connection = {
        remoteAddress,
        encrypted: event.headers['x-forwarded-proto'] === 'https'
    };

    // Add required methods
    req.on = (event, handler) => req.addListener(event, handler);
    req.destroy = () => {};
    req.setTimeout = () => {};
    req.setEncoding = () => {};

    // Create readable stream for body
    if (event.body) {
        const bodyStream = new Readable({
            read() {
                this.push(event.body);
                this.push(null);
            }
        });
        req.pipe = (destination) => bodyStream.pipe(destination);
    }

    return req;
}

// Create a proper response object
function createResponseObject(resolve) {
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
        body: ''
    };

    const res = new EventEmitter();
    
    // Add required methods
    res.setHeader = (key, value) => {
        response.headers[key] = value;
    };
    res.removeHeader = (key) => {
        delete response.headers[key];
    };
    res.getHeader = (key) => response.headers[key];
    res.writeHead = (status, headers) => {
        response.statusCode = status;
        if (headers) {
            Object.assign(response.headers, headers);
        }
    };
    res.write = (data) => {
        if (data) {
            response.body += data.toString();
        }
    };
    res.end = (data) => {
        if (data) {
            response.body += data.toString();
        }
        resolve(response);
    };

    return res;
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
                path: '/socket.io',
                serveClient: false,
                pingTimeout: 60000,
                pingInterval: 25000,
                connectTimeout: 45000,
                maxHttpBufferSize: 1e8,
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
        if (event.path.startsWith('/socket.io')) {
            return await new Promise((resolve) => {
                const req = createRequestObject(event);
                const res = createResponseObject(resolve);

                try {
                    io.engine.handleRequest(req, res);
                } catch (error) {
                    console.error('Socket.IO error:', error);
                    resolve({
                        statusCode: 500,
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        },
                        body: JSON.stringify({
                            error: 'Socket.IO error',
                            message: error.message
                        })
                    });
                }
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
                message: error.message
            })
        };
    }
};
