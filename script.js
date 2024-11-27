document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const startButton = document.getElementById('startChat');
    const nextButton = document.getElementById('nextChat');
    const muteAudioButton = document.getElementById('muteAudio');
    const muteVideoButton = document.getElementById('muteVideo');
    const shareScreenButton = document.getElementById('shareScreen');
    const chatInput = document.getElementById('messageInput');
    const sendMessageButton = document.getElementById('sendMessage');
    const chatMessages = document.getElementById('messages');
    const endCallButton = document.getElementById('endCall');
    const waitingScreen = document.getElementById('waiting-screen');

    // WebRTC Configuration
    const configuration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    };

    // Global variables
    let socket;
    let localStream;
    let peerConnection;
    let currentRoom;
    let isInitiator = false;

    // Initialize Socket.IO connection
    function initializeSocket() {
        socket = io();

        socket.on('room-joined', ({ roomId }) => {
            currentRoom = roomId;
            showSystemMessage('Connected to chat room');
        });

        socket.on('peer-found', ({ initiator }) => {
            isInitiator = initiator;
            waitingScreen.classList.add('hidden');
            startPeerConnection();
        });

        socket.on('signal', handleSignalingData);

        socket.on('peer-disconnected', handlePeerDisconnected);

        socket.on('message', ({ sender, text }) => {
            displayMessage(text, sender === socket.id);
        });
    }

    // Initialize media stream
    async function initializeStream(constraints = { video: true, audio: true }) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            localVideo.srcObject = localStream;
            return true;
        } catch (error) {
            console.error('Error accessing media devices:', error);
            showSystemMessage('Error accessing camera/microphone');
            return false;
        }
    }

    // Start peer connection
    async function startPeerConnection() {
        if (peerConnection) {
            peerConnection.close();
        }

        peerConnection = new RTCPeerConnection(configuration);

        // Add local stream
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Handle ICE candidates
        peerConnection.onicecandidate = ({ candidate }) => {
            if (candidate) {
                socket.emit('signal', { type: 'ice-candidate', candidate });
            }
        };

        // Handle incoming stream
        peerConnection.ontrack = (event) => {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                showSystemMessage('Peer connected');
            }
        };

        // Create offer if initiator
        if (isInitiator) {
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('signal', { type: 'offer', offer });
            } catch (error) {
                console.error('Error creating offer:', error);
                showSystemMessage('Error creating connection');
            }
        }
    }

    // Handle signaling data
    async function handleSignalingData(data) {
        try {
            if (data.type === 'offer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('signal', { type: 'answer', answer });
            }
            else if (data.type === 'answer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            else if (data.type === 'ice-candidate') {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('Error handling signaling data:', error);
            showSystemMessage('Connection error');
        }
    }

    // Handle peer disconnection
    function handlePeerDisconnected() {
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        showSystemMessage('Peer disconnected');
        nextButton.disabled = false;
        waitingScreen.classList.add('hidden');
    }

    // Display chat message
    function displayMessage(message, isOwnMessage) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwnMessage ? 'own-message' : 'peer-message'}`;
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Show system message
    function showSystemMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Event Listeners
    startButton.addEventListener('click', async () => {
        if (await initializeStream()) {
            initializeSocket();
            socket.emit('find-peer');
            startButton.disabled = true;
            nextButton.disabled = false;
            waitingScreen.classList.remove('hidden');
            showSystemMessage('Looking for a peer...');
        }
    });

    nextButton.addEventListener('click', () => {
        if (peerConnection) {
            peerConnection.close();
            remoteVideo.srcObject = null;
        }
        socket.emit('leave-room');
        socket.emit('find-peer');
        nextButton.disabled = true;
        waitingScreen.classList.remove('hidden');
        showSystemMessage('Looking for a new peer...');
    });

    muteAudioButton.addEventListener('click', () => {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            muteAudioButton.innerHTML = audioTrack.enabled ? 
                '<i class="fas fa-microphone"></i>' : 
                '<i class="fas fa-microphone-slash"></i>';
        }
    });

    muteVideoButton.addEventListener('click', () => {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            muteVideoButton.innerHTML = videoTrack.enabled ? 
                '<i class="fas fa-video"></i>' : 
                '<i class="fas fa-video-slash"></i>';
        }
    });

    shareScreenButton.addEventListener('click', async () => {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const videoTrack = screenStream.getVideoTracks()[0];
            
            const sender = peerConnection
                .getSenders()
                .find(s => s.track.kind === 'video');
                
            await sender.replaceTrack(videoTrack);
            
            videoTrack.onended = async () => {
                const cameraTrack = localStream.getVideoTracks()[0];
                await sender.replaceTrack(cameraTrack);
                shareScreenButton.innerHTML = '<i class="fas fa-desktop"></i>';
            };
            
            shareScreenButton.innerHTML = '<i class="fas fa-stop-circle"></i>';
            showSystemMessage('Screen sharing started');
        } catch (error) {
            console.error('Error sharing screen:', error);
            showSystemMessage('Error sharing screen');
        }
    });

    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendMessageButton.click();
        }
    });

    sendMessageButton.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message && socket) {
            socket.emit('message', message);
            displayMessage(message, true);
            chatInput.value = '';
        }
    });

    endCallButton.addEventListener('click', () => {
        if (peerConnection) {
            peerConnection.close();
            remoteVideo.srcObject = null;
        }
        if (socket) {
            socket.emit('leave-room');
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
        startButton.disabled = false;
        nextButton.disabled = true;
        waitingScreen.classList.add('hidden');
        showSystemMessage('Call ended');
    });
});
