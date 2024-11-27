const { Server } = require('socket.io');
const { uniqueNamesGenerator, colors, animals } = require('unique-names-generator');

// Customize the name generator config for shorter names
const nameConfig = {
    dictionaries: [colors, animals],
    separator: '',
    length: 2,
    style: 'capital'
};

// Generate nickname for a user
function generateNickname() {
    return uniqueNamesGenerator(nameConfig);
}

// Room management
const rooms = new Map(); // roomId -> { users: [socketId], messages: [] }
const userToRoom = new Map(); // socketId -> roomId
const users = new Map(); // socketId -> { nickname }
let waitingUsers = [];

exports.handler = async function(event, context) {
    // Handle WebSocket upgrade
    if (event.httpMethod === 'GET') {
        const headers = event.headers || {};
        const isWebSocket = headers.upgrade?.toLowerCase() === 'websocket';
        
        if (isWebSocket) {
            return {
                statusCode: 101,
                headers: {
                    'Upgrade': 'websocket',
                    'Connection': 'Upgrade',
                    'Sec-WebSocket-Accept': headers['sec-websocket-key'],
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                }
            };
        }
    }

    // Handle OPTIONS request for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400'
            }
        };
    }

    const io = new Server({
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
            allowedHeaders: ['*']
        },
        path: '/socket.io',
        transports: ['polling', 'websocket'],
        pingTimeout: 20000,
        pingInterval: 10000,
        upgradeTimeout: 30000,
        allowEIO3: true,
        serveClient: false,
        maxHttpBufferSize: 1e8,
        perMessageDeflate: false,
        httpCompression: true
    });

    io.on('connection', (socket) => {
        try {
            console.log('New connection:', socket.id);
            
            // Generate and store nickname for the user
            const nickname = generateNickname();
            users.set(socket.id, { nickname });
            
            console.log(`User connected: ${socket.id} (${nickname})`);
            socket.emit('nickname', nickname);

            // Handle disconnection
            socket.on('disconnect', (reason) => {
                console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
                handleDisconnect(socket);
            });

            // Handle find peer request
            socket.on('find-peer', () => {
                console.log('Finding peer for:', socket.id);
                handleFindPeer(socket, io);
            });

            // Handle signaling data
            socket.on('signal', (data) => {
                handleSignal(socket, data, io);
            });

            // Handle public room join
            socket.on('join-public-room', () => {
                console.log('Joining public room:', socket.id);
                handleJoinPublicRoom(socket, io);
            });

            // Handle messages
            socket.on('message', (data) => {
                handleMessage(socket, data, io);
            });

            // Handle public messages
            socket.on('public-message', (data) => {
                handlePublicMessage(socket, data, io);
            });

        } catch (error) {
            console.error('Socket error:', error);
            socket.emit('error', { message: 'Internal server error' });
        }
    });

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'Socket.IO server is running' })
    };
};

// Helper functions
function handleDisconnect(socket) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            room.users = room.users.filter(id => id !== socket.id);
            if (room.users.length === 0) {
                rooms.delete(roomId);
            } else {
                socket.to(roomId).emit('peer-disconnected');
            }
        }
    }
    users.delete(socket.id);
    userToRoom.delete(socket.id);
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
}

function handleFindPeer(socket, io) {
    if (waitingUsers.length > 0 && waitingUsers[0] !== socket.id) {
        const peer = waitingUsers.shift();
        const roomId = generateRoomId();
        
        socket.join(roomId);
        io.sockets.sockets.get(peer)?.join(roomId);
        
        rooms.set(roomId, { users: [socket.id, peer], messages: [] });
        userToRoom.set(socket.id, roomId);
        userToRoom.set(peer, roomId);
        
        io.to(peer).emit('peer-found', { initiator: true });
        socket.emit('peer-found', { initiator: false });
    } else if (!waitingUsers.includes(socket.id)) {
        waitingUsers.push(socket.id);
    }
}

function handleSignal(socket, data, io) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            const peer = room.users.find(id => id !== socket.id);
            if (peer) {
                socket.to(peer).emit('signal', data);
            }
        }
    }
}

function handleJoinPublicRoom(socket, io) {
    const publicRoomId = 'public';
    socket.join(publicRoomId);
    userToRoom.set(socket.id, publicRoomId);
    
    if (!rooms.has(publicRoomId)) {
        rooms.set(publicRoomId, { users: [], messages: [] });
    }
    
    const room = rooms.get(publicRoomId);
    room.users.push(socket.id);
    
    socket.emit('public-room-joined', {
        roomId: publicRoomId,
        name: 'Public Chat',
        userCount: room.users.length,
        recentMessages: room.messages.slice(-50),
        nickname: users.get(socket.id)?.nickname
    });
    
    io.to(publicRoomId).emit('user-count-updated', {
        userCount: room.users.length
    });
}

function handleMessage(socket, { text }, io) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const message = {
            sender: socket.id,
            text,
            timestamp: Date.now(),
            nickname: users.get(socket.id)?.nickname
        };
        io.to(roomId).emit('message', message);
    }
}

function handlePublicMessage(socket, { text }, io) {
    const publicRoomId = 'public';
    const room = rooms.get(publicRoomId);
    if (room) {
        const message = {
            sender: socket.id,
            text,
            timestamp: Date.now(),
            nickname: users.get(socket.id)?.nickname
        };
        room.messages.push(message);
        if (room.messages.length > 100) {
            room.messages.shift();
        }
        io.to(publicRoomId).emit('public-message', message);
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 15);
}
