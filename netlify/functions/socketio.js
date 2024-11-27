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

exports.handler = async (event, context) => {
    try {
        if (!event.headers['upgrade'] || event.headers['upgrade'].toLowerCase() !== 'websocket') {
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
            transports: ['websocket']
        });

        io.on('connection', (socket) => {
            try {
                // Generate and store nickname for the user
                const nickname = generateNickname();
                users.set(socket.id, { nickname });
                
                console.log(`User connected: ${socket.id} (${nickname})`);
                socket.emit('nickname', nickname);

                // Handle find peer request
                socket.on('find-peer', () => {
                    try {
                        console.log('User looking for peer:', socket.id);

                        if (waitingUsers.length > 0 && waitingUsers[0] !== socket.id) {
                            const peer = waitingUsers.shift();
                            const roomId = `${socket.id}-${peer}`;
                            
                            // Create room
                            rooms.set(roomId, {
                                users: [socket.id, peer],
                                messages: []
                            });
                            
                            // Map users to room
                            userToRoom.set(socket.id, roomId);
                            userToRoom.set(peer, roomId);
                            
                            // Join room
                            socket.join(roomId);
                            io.sockets.sockets.get(peer)?.join(roomId);
                            
                            // Notify users
                            io.to(roomId).emit('peer-found', {
                                roomId,
                                users: {
                                    [socket.id]: users.get(socket.id)?.nickname,
                                    [peer]: users.get(peer)?.nickname
                                }
                            });
                        } else {
                            waitingUsers.push(socket.id);
                        }
                    } catch (error) {
                        console.error('Error in find-peer:', error);
                        socket.emit('error', { message: 'Failed to find peer' });
                    }
                });

                socket.on('signal', (data) => {
                    try {
                        const roomId = userToRoom.get(socket.id);
                        if (roomId) {
                            const room = rooms.get(roomId);
                            const peer = room.users.find(id => id !== socket.id);
                            if (peer) {
                                io.to(peer).emit('signal', data);
                            }
                        }
                    } catch (error) {
                        console.error('Error in signal:', error);
                        socket.emit('error', { message: 'Failed to send signal' });
                    }
                });

                socket.on('disconnect', () => {
                    try {
                        console.log('User disconnected:', socket.id);
                        
                        // Remove from waiting list if present
                        const waitingIndex = waitingUsers.indexOf(socket.id);
                        if (waitingIndex !== -1) {
                            waitingUsers.splice(waitingIndex, 1);
                        }
                        
                        // Handle room cleanup
                        const roomId = userToRoom.get(socket.id);
                        if (roomId) {
                            const room = rooms.get(roomId);
                            if (room) {
                                const peer = room.users.find(id => id !== socket.id);
                                if (peer) {
                                    io.to(peer).emit('peer-disconnected');
                                    userToRoom.delete(peer);
                                }
                            }
                            rooms.delete(roomId);
                        }
                        
                        userToRoom.delete(socket.id);
                        users.delete(socket.id);
                    } catch (error) {
                        console.error('Error in disconnect:', error);
                    }
                });
            } catch (error) {
                console.error('Error in socket connection:', error);
                socket.emit('error', { message: 'Connection error' });
            }
        });

        return {
            statusCode: 200,
            body: 'WebSocket connection established'
        };
    } catch (error) {
        console.error('Error in handler:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
