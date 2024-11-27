class StreamingViewer {
    constructor() {
        this.ws = null;
        this.peerConnection = null;
        this.remoteStream = null;
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
            // Connect to WebSocket server
            this.connectWebSocket();
        } catch (error) {
            console.error('Error initializing viewer:', error);
            throw error;
        }
    }

    connectWebSocket() {
        // Create WebSocket connection
        this.ws = new WebSocket('ws://' + window.location.host);

        this.ws.onopen = () => {
            console.log('WebSocket connection established');
            // Join room as viewer
            this.ws.send(JSON.stringify({
                type: 'join-room',
                role: 'viewer'
            }));
        };

        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            console.log('Received message:', message.type);

            switch (message.type) {
                case 'room-joined':
                    this.userId = message.userId;
                    this.roomId = message.roomId;
                    break;

                case 'host-offer':
                    await this.handleOffer(message.offer);
                    break;

                case 'ice-candidate':
                    await this.handleIceCandidate(message.candidate);
                    break;

                case 'host-disconnected':
                    this.handleHostDisconnected();
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

    async handleOffer(offer) {
        try {
            // Create a new RTCPeerConnection if it doesn't exist
            if (!this.peerConnection) {
                this.peerConnection = new RTCPeerConnection(this.configuration);

                // Set up event handlers
                this.peerConnection.ontrack = (event) => {
                    console.log('Received remote track:', event.track.kind);
                    const remoteVideo = document.getElementById('remoteVideo');
                    if (remoteVideo) {
                        if (!remoteVideo.srcObject) {
                            remoteVideo.srcObject = new MediaStream();
                        }
                        remoteVideo.srcObject.addTrack(event.track);
                    }
                };

                this.peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        this.ws.send(JSON.stringify({
                            type: 'ice-candidate',
                            candidate: event.candidate,
                            role: 'viewer'
                        }));
                    }
                };

                this.peerConnection.onconnectionstatechange = () => {
                    console.log('Connection state:', this.peerConnection.connectionState);
                };

                this.peerConnection.oniceconnectionstatechange = () => {
                    console.log('ICE connection state:', this.peerConnection.iceConnectionState);
                };
            }

            // Set remote description (offer from host)
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            // Create and set local description (answer)
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // Send answer to host
            this.ws.send(JSON.stringify({
                type: 'viewer-answer',
                answer: answer
            }));
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    handleHostDisconnected() {
        console.log('Host disconnected');
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            remoteVideo.srcObject = null;
        }
        this.cleanup();
    }

    cleanup() {
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // Close WebSocket connection
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
        }
    }
}

// Create and initialize viewer when the page loads
window.addEventListener('load', async () => {
    const viewer = new StreamingViewer();
    window.viewer = viewer; // Store reference globally for debugging

    try {
        await viewer.initialize();
        console.log('Viewer initialized successfully');
    } catch (error) {
        console.error('Failed to initialize viewer:', error);
    }
});
