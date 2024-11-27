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

exports.handler = function(event, context) {
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    // Handle WebSocket upgrade
    if (event.headers['upgrade']?.toLowerCase() !== 'websocket') {
        return {
            statusCode: 426,
            body: 'Upgrade Required'
        };
    }

    const io = new Server({
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true
        },
        path: '/.netlify/functions/socketio',
        transports: ['websocket'],
        pingTimeout: 10000,
        pingInterval: 5000
    });

    io.on('connection', (socket) => {
        try {
            // Generate and store nickname for the user
            const nickname = generateNickname();
            users.set(socket.id, { nickname });
            
            console.log(`User connected: ${socket.id} (${nickname})`);
            socket.emit('nickname', nickname);

            // Handle disconnection
            socket.on('disconnect', () => {
                handleDisconnect(socket);
            });

            // Handle find peer request
            socket.on('find-peer', () => {
                handleFindPeer(socket);
            });

            // Handle signaling data
            socket.on('signal', (data) => {
                handleSignal(socket, data);
            });

            // Handle public room join
            socket.on('join-public-room', () => {
                handleJoinPublicRoom(socket);
            });

            // Handle messages
            socket.on('message', (data) => {
                handleMessage(socket, data);
            });

            // Handle public messages
            socket.on('public-message', (data) => {
                handlePublicMessage(socket, data);
            });
        } catch (error) {
            console.error('Error in socket connection:', error);
            socket.emit('error', { message: 'Internal server error' });
        }
    });

    return {
        statusCode: 200,
        body: 'WebSocket connection established'
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
                io.to(roomId).emit('peer-disconnected');
            }
        }
    }
    users.delete(socket.id);
    userToRoom.delete(socket.id);
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
}

function handleFindPeer(socket) {
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

function handleSignal(socket, data) {
    const roomId = userToRoom.get(socket.id);
    if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
            const peer = room.users.find(id => id !== socket.id);
            if (peer) {
                io.to(peer).emit('signal', data);
            }
        }
    }
}

function handleJoinPublicRoom(socket) {
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

function handleMessage(socket, { text }) {
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

function handlePublicMessage(socket, { text }) {
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
