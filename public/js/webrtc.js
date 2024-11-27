class WebRTCHandler {
    constructor() {
        this.localStream = null;
        this.peers = new Map(); // Map of peerId -> RTCPeerConnection
        this.localVideo = document.getElementById('localVideo');
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Add your TURN server configuration here
            ]
        };
        
        this.ws = null;
        this.roomId = null;
    }

    async initialize() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            this.localVideo.srcObject = this.localStream;
            
            // Connect to signaling server
            this.connectSignaling();
        } catch (error) {
            console.error('Error initializing WebRTC:', error);
            throw error;
        }
    }

    connectSignaling() {
        // Replace with your Cloudflare Workers WebSocket URL
        this.ws = new WebSocket('wss://your-worker.your-subdomain.workers.dev');
        
        this.ws.onopen = () => {
            console.log('Connected to signaling server');
        };

        this.ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await this.handleSignalingMessage(message);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('Disconnected from signaling server');
        };
    }

    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'join':
                this.roomId = message.roomId;
                break;
            case 'new-peer':
                await this.createPeerConnection(message.peerId);
                break;
            case 'offer':
                await this.handleOffer(message.peerId, message.offer);
                break;
            case 'answer':
                await this.handleAnswer(message.peerId, message.answer);
                break;
            case 'ice-candidate':
                await this.handleIceCandidate(message.peerId, message.candidate);
                break;
            case 'peer-disconnected':
                this.removePeer(message.peerId);
                break;
        }
    }

    async createPeerConnection(peerId) {
        const peerConnection = new RTCPeerConnection(this.configuration);
        this.peers.set(peerId, peerConnection);

        // Add local tracks to the peer connection
        this.localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, this.localStream);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    peerId: peerId,
                    candidate: event.candidate
                }));
            }
        };

        // Handle remote tracks
        peerConnection.ontrack = (event) => {
            this.handleRemoteTrack(peerId, event.streams[0]);
        };

        // Create and send offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        this.ws.send(JSON.stringify({
            type: 'offer',
            peerId: peerId,
            offer: offer
        }));
    }

    async handleOffer(peerId, offer) {
        const peerConnection = new RTCPeerConnection(this.configuration);
        this.peers.set(peerId, peerConnection);

        // Add local tracks
        this.localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, this.localStream);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    peerId: peerId,
                    candidate: event.candidate
                }));
            }
        };

        // Handle remote tracks
        peerConnection.ontrack = (event) => {
            this.handleRemoteTrack(peerId, event.streams[0]);
        };

        // Set remote description and create answer
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        this.ws.send(JSON.stringify({
            type: 'answer',
            peerId: peerId,
            answer: answer
        }));
    }

    async handleAnswer(peerId, answer) {
        const peerConnection = this.peers.get(peerId);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    async handleIceCandidate(peerId, candidate) {
        const peerConnection = this.peers.get(peerId);
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    handleRemoteTrack(peerId, stream) {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remote-video-${peerId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.srcObject = stream;

        const videoBox = document.createElement('div');
        videoBox.className = 'video-box';
        videoBox.id = `peer-${peerId}`;
        videoBox.appendChild(remoteVideo);

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = `Peer ${peerId}`;
        videoBox.appendChild(label);

        document.getElementById('remoteVideosGrid').appendChild(videoBox);
    }

    removePeer(peerId) {
        const peerConnection = this.peers.get(peerId);
        if (peerConnection) {
            peerConnection.close();
            this.peers.delete(peerId);
        }

        const videoBox = document.getElementById(`peer-${peerId}`);
        if (videoBox) {
            videoBox.remove();
        }
    }

    async toggleAudio() {
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            return audioTrack.enabled;
        }
        return false;
    }

    async toggleVideo() {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            return videoTrack.enabled;
        }
        return false;
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }

        this.peers.forEach((peerConnection) => {
            peerConnection.close();
        });
        this.peers.clear();

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }

        document.getElementById('remoteVideosGrid').innerHTML = '';
    }
}
