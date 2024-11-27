let rooms = new Map();

export default {
    async fetch(request, env) {
        if (request.headers.get('Upgrade') === 'websocket') {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            server.accept();

            let peerId = crypto.randomUUID();
            let roomId = null;

            server.addEventListener('message', async (event) => {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case 'join':
                        // Find or create a room with available slots
                        for (const [id, room] of rooms) {
                            if (room.size < 8) { // Limit 8 participants per room
                                roomId = id;
                                break;
                            }
                        }

                        if (!roomId) {
                            roomId = crypto.randomUUID();
                            rooms.set(roomId, new Map());
                        }

                        const room = rooms.get(roomId);
                        room.set(peerId, server);

                        // Notify the client about their room assignment
                        server.send(JSON.stringify({
                            type: 'join',
                            roomId: roomId,
                            peerId: peerId
                        }));

                        // Notify other peers in the room about the new peer
                        room.forEach((peer, id) => {
                            if (id !== peerId) {
                                peer.send(JSON.stringify({
                                    type: 'new-peer',
                                    peerId: peerId
                                }));
                                server.send(JSON.stringify({
                                    type: 'new-peer',
                                    peerId: id
                                }));
                            }
                        });
                        break;

                    case 'offer':
                    case 'answer':
                    case 'ice-candidate':
                        if (roomId) {
                            const room = rooms.get(roomId);
                            const targetPeer = room.get(message.peerId);
                            if (targetPeer) {
                                message.peerId = peerId;
                                targetPeer.send(JSON.stringify(message));
                            }
                        }
                        break;
                }
            });

            server.addEventListener('close', () => {
                if (roomId) {
                    const room = rooms.get(roomId);
                    if (room) {
                        room.delete(peerId);
                        
                        // Notify other peers about the disconnection
                        room.forEach(peer => {
                            peer.send(JSON.stringify({
                                type: 'peer-disconnected',
                                peerId: peerId
                            }));
                        });

                        // Remove empty rooms
                        if (room.size === 0) {
                            rooms.delete(roomId);
                        }
                    }
                }
            });

            return new Response(null, {
                status: 101,
                webSocket: client
            });
        }

        return new Response('Expected WebSocket connection', { status: 400 });
    }
};
