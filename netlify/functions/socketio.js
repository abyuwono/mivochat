const engine = require('engine.io');
const { Server: SocketServer } = require('socket.io');
const { parse } = require('querystring');

// In-memory storage for connections and peers
const peers = new Map();
const connections = new Map();
let engineServer = null;
let io = null;

// Handle Socket.IO protocol
function handleSocketIO(data) {
    try {
        const [type, ...rest] = data.toString().split(':');
        const payload = rest.join(':');
        
        switch (type) {
            case '0': // Connect
                return `40${payload}`; // Connect ACK
            case '2': // Ping
                return '3'; // Pong
            case '4': // Message
                return handleMessage(payload);
            default:
                return '';
        }
    } catch (error) {
        console.error('Protocol error:', error);
        return '';
    }
}

// Handle Socket.IO messages
function handleMessage(data) {
    try {
        if (!data) return '';
        const [messageType, namespace, payload] = data.split(',');
        
        // Handle different message types
        switch (messageType) {
            case '0': // Connect
                return '40'; // Connect ACK
            case '2': // Event
                const event = JSON.parse(payload || '{}');
                handleEvent(event);
                return '';
            default:
                return '';
        }
    } catch (error) {
        console.error('Message error:', error);
        return '';
    }
}

// Handle Socket.IO events
function handleEvent(event) {
    try {
        const [eventName, ...args] = event;
        
        switch (eventName) {
            case 'find-peer':
                handleFindPeer(...args);
                break;
            case 'signal':
                handleSignal(...args);
                break;
            default:
                break;
        }
    } catch (error) {
        console.error('Event error:', error);
    }
}

// Handle find-peer event
function handleFindPeer(socketId) {
    try {
        const availablePeers = Array.from(peers.entries())
            .filter(([id, peer]) => id !== socketId && !peer.busy);
        
        if (availablePeers.length > 0) {
            const [peerId, _] = availablePeers[0];
            const roomId = `room_${Date.now()}`;
            
            peers.set(socketId, { busy: true, room: roomId });
            peers.set(peerId, { busy: true, room: roomId });
            
            const socket = connections.get(socketId);
            const peerSocket = connections.get(peerId);
            
            if (socket && peerSocket) {
                socket.send(JSON.stringify(['peer-found', { isInitiator: true }]));
                peerSocket.send(JSON.stringify(['peer-found', { isInitiator: false }]));
            }
        }
    } catch (error) {
        console.error('Find peer error:', error);
    }
}

// Handle signal event
function handleSignal(data, socketId) {
    try {
        const peer = peers.get(socketId);
        if (peer?.room) {
            const roomPeers = Array.from(peers.entries())
                .filter(([id, p]) => p.room === peer.room && id !== socketId)
                .map(([id]) => id);
            
            roomPeers.forEach(peerId => {
                const peerSocket = connections.get(peerId);
                if (peerSocket) {
                    peerSocket.send(JSON.stringify(['signal', data]));
                }
            });
        }
    } catch (error) {
        console.error('Signal error:', error);
    }
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
        // Initialize engine.io server if not already initialized
        if (!engineServer) {
            engineServer = engine.attach({
                pingTimeout: 60000,
                pingInterval: 25000,
                transports: ['polling', 'websocket'],
                cors: {
                    origin: '*',
                    methods: ['GET', 'POST', 'OPTIONS'],
                    credentials: true
                }
            });

            // Handle engine.io connections
            engineServer.on('connection', socket => {
                const socketId = socket.id;
                connections.set(socketId, socket);
                peers.set(socketId, { busy: false });

                console.log('Client connected:', socketId);

                socket.on('message', data => {
                    const response = handleSocketIO(data);
                    if (response) {
                        socket.send(response);
                    }
                });

                socket.on('close', () => {
                    const peer = peers.get(socketId);
                    if (peer?.room) {
                        const roomPeers = Array.from(peers.entries())
                            .filter(([_, p]) => p.room === peer.room)
                            .map(([id]) => id);
                        
                        roomPeers.forEach(id => {
                            const peerSocket = connections.get(id);
                            if (peerSocket && id !== socketId) {
                                peerSocket.send(JSON.stringify(['peer-disconnected']));
                            }
                            peers.delete(id);
                        });
                    }
                    connections.delete(socketId);
                    peers.delete(socketId);
                    console.log('Client disconnected:', socketId);
                });
            });
        }

        // Handle engine.io requests
        if (event.path.startsWith('/socket.io')) {
            return await new Promise((resolve) => {
                const req = {
                    method: event.httpMethod,
                    url: event.path + (event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : ''),
                    headers: {
                        ...event.headers,
                        'content-type': event.headers['content-type'] || 'application/octet-stream',
                        'content-length': event.body ? Buffer.byteLength(event.body) : 0
                    },
                    body: event.body || ''
                };

                const res = {
                    writeHead: (status, headers) => {
                        res.statusCode = status;
                        res.headers = headers;
                    },
                    setHeader: (key, value) => {
                        if (!res.headers) res.headers = {};
                        res.headers[key] = value;
                    },
                    end: (data) => {
                        resolve({
                            statusCode: res.statusCode || 200,
                            headers: {
                                ...res.headers,
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                                'Access-Control-Allow-Headers': '*',
                                'Access-Control-Allow-Credentials': 'true',
                                'Cache-Control': 'no-cache'
                            },
                            body: data
                        });
                    }
                };

                engineServer.handleRequest(req, res);
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
