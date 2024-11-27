class StreamingHost {
    constructor() {
        this.ws = null;
        this.localStream = null;
        this.peerConnections = new Map();
        this.isHost = false;
        this.userId = null;
        this.roomId = null;

        // WebRTC configuration
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
            ]
        };
    }

    async initialize() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            // Display local video
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
            localVideo.play().catch(error => console.error('Error playing local video:', error));

            // Connect to WebSocket server
            this.connectWebSocket();
        } catch (error) {
            console.error('Error initializing host:', error);
            throw error;
        }
    }

    connectWebSocket() {
        // Create WebSocket connection
        this.ws = new WebSocket('ws://' + window.location.host);

        this.ws.onopen = () => {
            console.log('WebSocket connection established');
            // Join room as host
            this.ws.send(JSON.stringify({
                type: 'join-room',
                role: 'host'
            }));
        };

        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            console.log('Received message:', message.type);

            switch (message.type) {
                case 'room-joined':
                    this.userId = message.userId;
                    this.roomId = message.roomId;
                    this.isHost = message.isHost;
                    break;

                case 'host-status-update':
                    this.isHost = message.isHost;
                    if (this.isHost) {
                        this.startHosting();
                    }
                    break;

                case 'answer':
                    await this.handleAnswer(message.answer, message.viewerId);
                    break;

                case 'ice-candidate':
                    await this.handleIceCandidate(message.candidate, message.viewerId);
                    break;
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
            this.cleanup();
        };
    }

    async startHosting() {
        try {
            // Create a new RTCPeerConnection for each viewer
            const peerConnection = new RTCPeerConnection(this.configuration);
            
            // Add local stream tracks to the peer connection
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });

            // Create and send offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.ws.send(JSON.stringify({
                type: 'offer',
                offer: offer
            }));

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    this.ws.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        role: 'host'
                    }));
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', peerConnection.connectionState);
            };

            // Handle ICE connection state changes
            peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', peerConnection.iceConnectionState);
            };
        } catch (error) {
            console.error('Error starting host:', error);
        }
    }

    async handleAnswer(answer, viewerId) {
        try {
            const peerConnection = this.peerConnections.get(viewerId) || new RTCPeerConnection(this.configuration);
            
            if (!this.peerConnections.has(viewerId)) {
                // Add local stream tracks to the peer connection
                this.localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, this.localStream);
                });
                this.peerConnections.set(viewerId, peerConnection);
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate, viewerId) {
        try {
            const peerConnection = this.peerConnections.get(viewerId);
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    cleanup() {
        // Stop all tracks in the local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }

        // Close all peer connections
        this.peerConnections.forEach(connection => {
            connection.close();
        });
        this.peerConnections.clear();

        // Close WebSocket connection
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
    }
}

// Create and initialize host when the page loads
window.addEventListener('load', async () => {
    const host = new StreamingHost();
    window.host = host; // Store reference globally for debugging

    try {
        await host.initialize();
        console.log('Host initialized successfully');
    } catch (error) {
        console.error('Failed to initialize host:', error);
    }
});
