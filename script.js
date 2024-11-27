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
    const userCount = document.getElementById('userCount');

    // Global variables
    let socket;
    let localStream;
    let peerConnection;
    let currentRoom;
    let isInitiator = false;
    let isInPublicRoom = false;
    let myNickname = '';
    let currentRoomId = null;
    let connectedPeers = {};

    // Update chat header to show connection info
    function updateChatHeader(roomId = null, peerNickname = null) {
        const chatHeader = document.querySelector('.chat-header');
        if (!chatHeader) return;

        if (roomId && peerNickname) {
            chatHeader.innerHTML = `
                <div class="chat-header-main">
                    <h3>Chat Room</h3>
                    <span class="connection-status connected">Connected</span>
                </div>
                <div class="chat-header-info">
                    <span class="room-id">Room ID: ${roomId}</span>
                    <span class="peer-name">Chatting with: ${peerNickname}</span>
                </div>
            `;
        } else {
            chatHeader.innerHTML = `
                <div class="chat-header-main">
                    <h3>Chat Room</h3>
                    <span class="connection-status disconnected">Disconnected</span>
                </div>
            `;
        }
    }

    // Initialize Socket.IO connection
    function initializeSocket() {
        socket = io({
            path: '/.netlify/functions/socketio',
            transports: ['websocket']
        });

        socket.on('room-joined', ({ roomId }) => {
            currentRoom = roomId;
            isInPublicRoom = false;
            showSystemMessage('Connected to private chat room');
        });

        socket.on('public-room-joined', ({ roomId, name, userCount, recentMessages, nickname }) => {
            currentRoom = roomId;
            isInPublicRoom = true;
            myNickname = nickname;
            showSystemMessage(`Connected to ${name} as ${nickname}`);
            updateUserCount(userCount);
            
            // Display recent messages
            chatMessages.innerHTML = ''; // Clear existing messages
            recentMessages.forEach(msg => {
                addMessageToChat(msg.text, msg.nickname, msg.sender === socket.id);
            });
        });

        socket.on('user-count-updated', ({ userCount: count }) => {
            updateUserCount(count);
        });

        socket.on('peer-found', ({ initiator }) => {
            isInitiator = initiator;
            waitingScreen.classList.add('hidden');
            startPeerConnection();
        });

        socket.on('signal', handleSignalingData);

        socket.on('peer-disconnected', handlePeerDisconnected);

        socket.on('message', ({ sender, text, timestamp, nickname }) => {
            addMessageToChat(text, nickname, sender === socket.id);
        });

        socket.on('public-message', ({ sender, text, timestamp, nickname }) => {
            addMessageToChat(text, nickname, sender === socket.id);
        });

        socket.on('nickname', (nickname) => {
            myNickname = nickname;
            // Update the local video overlay to show nickname
            const localOverlay = document.querySelector('.local-video-wrapper .video-overlay');
            if (localOverlay) {
                localOverlay.textContent = `You (${nickname})`;
            }
        });

        socket.on('peer-connected', ({ roomId, users }) => {
            currentRoomId = roomId;
            connectedPeers = users;
            
            // Find peer nickname (the one that's not us)
            const peerNickname = Object.entries(users)
                .find(([id, nickname]) => id !== socket.id)?.[1] || 'Anonymous';
            
            updateChatHeader(roomId, peerNickname);
            showSystemMessage(`Connected to ${peerNickname}`);
            
            // Hide waiting screen when connected
            document.getElementById('waiting-screen').classList.add('hidden');
            
            // Initialize WebRTC connection as initiator
            if (!peerConnection) {
                createPeerConnection(true);
            }
        });

        socket.on('peer-disconnected', () => {
            currentRoomId = null;
            connectedPeers = {};
            updateChatHeader();
            showSystemMessage('Peer disconnected');
            
            // Clean up WebRTC connection
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
            
            // Hide remote video
            if (remoteVideo.srcObject) {
                remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                remoteVideo.srcObject = null;
            }
            
            // Enable start chat button
            startButton.disabled = false;
            nextButton.disabled = true;
        });

        // Join public room by default
        socket.emit('join-public-room');
    }

    // Update the getUserMedia function to handle different browser implementations
    async function getLocalStream() {
        const constraints = {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            }
        };

        try {
            // Try the standard modern way
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } 
            // Fallback for older browsers
            else if (navigator.getUserMedia) {
                localStream = await new Promise((resolve, reject) => {
                    navigator.getUserMedia(constraints, resolve, reject);
                });
            }
            // Fallback for webkit browsers
            else if (navigator.webkitGetUserMedia) {
                localStream = await new Promise((resolve, reject) => {
                    navigator.webkitGetUserMedia(constraints, resolve, reject);
                });
            }
            // Fallback for mozilla browsers
            else if (navigator.mozGetUserMedia) {
                localStream = await new Promise((resolve, reject) => {
                    navigator.mozGetUserMedia(constraints, resolve, reject);
                });
            } else {
                throw new Error('getUserMedia is not supported in this browser');
            }

            if (localVideo) {
                localVideo.srcObject = localStream;
                await localVideo.play().catch(error => console.log('Autoplay prevented:', error));
            }

            // Enable the start chat button once we have local stream
            document.getElementById('startChat').disabled = false;
            
            // Check if we're on mobile and show camera switch button if supported
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = devices.filter(device => device.kind === 'videoinput');
                if (videoDevices.length > 1) {
                    const switchCameraButton = document.getElementById('switchCamera');
                    if (switchCameraButton) {
                        switchCameraButton.style.display = 'block';
                    }
                }
            }

        } catch (error) {
            console.error('Error accessing media devices:', error);
            alert('Error accessing camera/microphone: ' + error.message + '\nPlease ensure you have granted camera permissions and try again.');
        }
    }

    // Add camera switching functionality
    async function switchCamera() {
        if (!localStream) return;

        const currentTrack = localStream.getVideoTracks()[0];
        const currentFacingMode = currentTrack.getSettings().facingMode;
        const newFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: newFacingMode
            }
        };

        try {
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newTrack = newStream.getVideoTracks()[0];
            
            // Replace the track in the local stream
            const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                await sender.replaceTrack(newTrack);
            }

            // Replace the track in local video
            const tracks = localStream.getVideoTracks();
            tracks.forEach(track => track.stop());
            localStream.removeTrack(tracks[0]);
            localStream.addTrack(newTrack);
            
            if (localVideo) {
                localVideo.srcObject = localStream;
            }
        } catch (error) {
            console.error('Error switching camera:', error);
            alert('Failed to switch camera: ' + error.message);
        }
    }

    // Add event listener for camera switch button
    document.getElementById('switchCamera')?.addEventListener('click', switchCamera);

    // Handle orientation changes on mobile
    function handleOrientationChange() {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                // Get updated constraints based on new orientation
                const constraints = {
                    width: { ideal: window.innerWidth },
                    height: { ideal: window.innerHeight },
                    aspectRatio: { ideal: window.innerWidth / window.innerHeight }
                };
                videoTrack.applyConstraints(constraints).catch(console.error);
            }
        }
    }

    // Check for mobile device
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Initialize with device check
    async function initialize() {
        if (isMobileDevice()) {
            // Add mobile-specific meta viewport tag if not present
            if (!document.querySelector('meta[name="viewport"]')) {
                const metaViewport = document.createElement('meta');
                metaViewport.name = 'viewport';
                metaViewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
                document.head.appendChild(metaViewport);
            }
        }
        await getLocalStream();
        initializeSocket();
        updateChatHeader();
    }

    // Start initialization
    initialize();

    // Update user count display
    function updateUserCount(count) {
        if (userCount) {
            userCount.textContent = `${count} users online`;
        }
    }

    // Function to get ICE servers configuration
    async function getIceServers() {
        try {
            const response = await fetch('/api/ice-servers');
            const config = await response.json();
            return config;
        } catch (error) {
            console.error('Error fetching ICE servers:', error);
            // Fallback to basic STUN configuration
            return {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            };
        }
    }

    // Function to create peer connection
    async function createPeerConnection(isInitiator) {
        // Get ICE servers configuration
        const configuration = await getIceServers();
        
        peerConnection = new RTCPeerConnection(configuration);

        // Add local stream
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // Handle ICE candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('signal', { type: 'candidate', candidate: event.candidate });
            }
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                // Hide waiting screen when WebRTC connection is established
                waitingScreen.classList.add('hidden');
            }
        };

        // Handle receiving remote stream
        peerConnection.ontrack = event => {
            if (remoteVideo.srcObject !== event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                console.log('Received remote stream');
            }
        };

        // Handle connection failure
        peerConnection.onicecandidateerror = (event) => {
            console.error('ICE candidate error:', event);
            showSystemMessage('Connection error. Please try again.');
            waitingScreen.classList.add('hidden');
            startButton.disabled = false;
        };

        // Create offer if initiator
        if (isInitiator) {
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => {
                    socket.emit('signal', { type: 'offer', offer: peerConnection.localDescription });
                })
                .catch(error => {
                    console.error('Error creating offer:', error);
                    showSystemMessage('Error creating connection. Please try again.');
                });
        }

        return peerConnection;
    }

    // Update start button click handler
    startButton.addEventListener('click', async () => {
        try {
            // Show waiting screen immediately
            waitingScreen.classList.remove('hidden');
            startButton.disabled = true;
            showSystemMessage('Looking for a peer...');
            
            // Emit find-peer event
            socket.emit('find-peer');
        } catch (error) {
            console.error('Error starting chat:', error);
            showSystemMessage('Error starting chat: ' + error.message);
            waitingScreen.classList.add('hidden');
            startButton.disabled = false;
        }
    });

    // Update next button click handler
    nextButton.addEventListener('click', () => {
        // Show waiting screen
        waitingScreen.classList.remove('hidden');
        showSystemMessage('Looking for a new peer...');
        
        // Clean up current connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        // Clear remote video
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        
        // Find new peer
        socket.emit('find-peer');
    });

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
            else if (data.type === 'candidate') {
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

    // Format timestamp
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Function to add message to chat
    function addMessageToChat(message, sender, isMe) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isMe ? 'sent' : 'received'}`;
        
        const senderName = isMe ? `You (${myNickname})` : sender;
        
        messageElement.innerHTML = `
            <div class="message-sender">${senderName}</div>
            <div class="message-text">${escapeHtml(message)}</div>
        `;
        
        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Helper function to escape HTML to prevent XSS
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Show system message
    function showSystemMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.textContent = message;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    muteAudioButton.addEventListener('click', () => {
        const audioTrack = localStream?.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            muteAudioButton.innerHTML = audioTrack.enabled ? 
                '<i class="fas fa-microphone"></i>' : 
                '<i class="fas fa-microphone-slash"></i>';
        }
    });

    muteVideoButton.addEventListener('click', () => {
        const videoTrack = localStream?.getVideoTracks()[0];
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
            const message = chatInput.value.trim();
            if (message) {
                addMessageToChat(message, 'You', true);
                if (isInPublicRoom) {
                    socket.emit('public-message', message);
                } else {
                    socket.emit('message', message);
                }
                chatInput.value = '';
            }
        }
    });

    sendMessageButton.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message) {
            addMessageToChat(message, 'You', true);
            if (isInPublicRoom) {
                socket.emit('public-message', message);
            } else {
                socket.emit('message', message);
            }
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
            // Rejoin public room after ending call
            socket.emit('join-public-room');
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
