const { Server } = require('socket.io');
const { createServer } = require('http');
const { parse } = require('url');
const { Readable } = require('stream');

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
            transports: ['polling', 'websocket'],
            path: '/',
            serveClient: false,
            pingTimeout: 10000,
            pingInterval: 5000,
            connectTimeout: 45000,
            allowEIO3: true,
            addTrailingSlash: false
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

// Create a readable stream from a string
function createReadableStream(str) {
    const readable = new Readable();
    readable._read = () => {}; // Required but noop
    readable.push(str);
    readable.push(null);
    return readable;
}

// Handle Socket.IO request
async function handleSocketIORequest(event) {
    const io = initializeSocketIO();
    
    // Parse URL and remove the function path prefix
    const path = event.path || '/';
    const cleanPath = path.replace('/.netlify/functions/socketio', '');
    const parsedUrl = parse(cleanPath, true);
    
    // Create a proper request object that mimics a Node.js HTTP request
    const req = Object.assign(createReadableStream(event.body || ''), {
        method: event.httpMethod,
        url: cleanPath + (cleanPath.includes('?') ? '' : '?' + new URLSearchParams(event.queryStringParameters || {}).toString()),
        headers: event.headers || {},
        query: parsedUrl.query || event.queryStringParameters || {},
        connection: {
            remoteAddress: event.requestContext?.identity?.sourceIp || '0.0.0.0'
        }
    });

    // Create a proper response object that mimics a Node.js HTTP response
    let statusCode = 200;
    let responseHeaders = {};
    let responseBody = '';
    let headersSent = false;

    const res = {
        writeHead(status, headers) {
            if (!headersSent) {
                statusCode = status;
                if (headers) {
                    responseHeaders = { ...responseHeaders, ...headers };
                }
                headersSent = true;
            }
            return this;
        },
        setHeader(key, value) {
            if (!headersSent) {
                responseHeaders[key] = value;
            }
            return this;
        },
        getHeader(key) {
            return responseHeaders[key];
        },
        removeHeader(key) {
            delete responseHeaders[key];
            return this;
        },
        write(data) {
            responseBody += data;
            return this;
        },
        end(data) {
            if (data) {
                responseBody += data;
            }
        }
    };

    try {
        // Handle the Socket.IO request
        await new Promise((resolve, reject) => {
            io.engine.handleRequest(req, res);
            // Give some time for the engine to process
            setTimeout(resolve, 100);
        });

        return {
            statusCode,
            headers: {
                ...responseHeaders,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Credentials': 'true',
                'Cache-Control': 'no-cache',
                'Content-Type': responseHeaders['Content-Type'] || 'application/octet-stream'
            },
            body: responseBody
        };
    } catch (error) {
        console.error('Socket.IO request handling error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ 
                error: 'Socket.IO request handling error', 
                details: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
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
        if (event.httpMethod === 'GET' || event.httpMethod === 'POST') {
            return await handleSocketIORequest(event);
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
