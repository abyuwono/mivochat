// Socket.IO server configuration
const config = {
    SOCKET_SERVER: 'https://mivochat-production.up.railway.app',
    SOCKET_OPTIONS: {
        transports: ['websocket', 'polling'],
        reconnectionDelayMax: 10000,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        withCredentials: true
    }
};
