class CloudflareWebRTC {
    constructor() {
        console.log('🚀 Initializing CloudflareWebRTC...');
        this.configuration = {
            iceServers: [
                {
                    urls: [
                        'stun:stun.cloudflare.com:3478',
                        'stun:stun1.l.google.com:19302',
                        'stun:stun2.l.google.com:19302'
                    ]
                }
            ],
            iceCandidatePoolSize: 10
        };
        console.log('📡 WebRTC Configuration:', this.configuration);
    }

    async initializeConnection() {
        try {
            console.log('🔄 Creating new RTCPeerConnection...');
            const peerConnection = new RTCPeerConnection(this.configuration);
            
            // Set up connection state monitoring
            peerConnection.onconnectionstatechange = () => {
                console.log('🌐 Connection state changed:', {
                    state: peerConnection.connectionState,
                    timestamp: new Date().toISOString()
                });
            };

            peerConnection.oniceconnectionstatechange = () => {
                console.log('❄️ ICE connection state changed:', {
                    state: peerConnection.iceConnectionState,
                    timestamp: new Date().toISOString()
                });
            };

            peerConnection.onicegatheringstatechange = () => {
                console.log('🔍 ICE gathering state changed:', {
                    state: peerConnection.iceGatheringState,
                    timestamp: new Date().toISOString()
                });
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('📨 New ICE candidate:', {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        timestamp: new Date().toISOString()
                    });
                }
            };

            peerConnection.ontrack = (event) => {
                console.log('🎥 Remote track received:', {
                    kind: event.track.kind,
                    id: event.track.id,
                    timestamp: new Date().toISOString()
                });
            };

            console.log('✅ RTCPeerConnection created successfully');
            return { peerConnection };
        } catch (error) {
            console.error('❌ Error initializing WebRTC connection:', error);
            throw error;
        }
    }

    async createOffer(peerConnection) {
        try {
            console.log('📝 Creating offer...');
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            console.log('📤 Setting local description:', offer);
            await peerConnection.setLocalDescription(offer);
            return offer;
        } catch (error) {
            console.error('❌ Error creating offer:', error);
            throw error;
        }
    }

    async handleAnswer(peerConnection, answer) {
        try {
            console.log('📥 Handling answer:', answer);
            const rtcSessionDescription = new RTCSessionDescription(answer);
            await peerConnection.setRemoteDescription(rtcSessionDescription);
            console.log('✅ Remote description set successfully');
        } catch (error) {
            console.error('❌ Error handling answer:', error);
            throw error;
        }
    }

    async addIceCandidate(peerConnection, candidate) {
        try {
            console.log('❄️ Adding ICE candidate:', candidate);
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('✅ ICE candidate added successfully');
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
            throw error;
        }
    }
}

export default CloudflareWebRTC;
