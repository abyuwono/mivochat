document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const nextButton = document.getElementById('nextButton');
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
    let isConnected = false;

    // Update connection status and UI elements
    function updateConnectionStatus(isConnected, peerNickname = null, roomId = null) {
        const chatHeader = document.querySelector('.chat-header');
        const connectionStatus = document.querySelector('.connection-status');
        const chatControls = document.querySelector('.chat-controls');
        const remoteVideoOverlay = document.querySelector('.remote-video-wrapper .video-overlay');
        
        if (!chatHeader || !connectionStatus || !chatControls) return;

        if (isConnected && peerNickname) {
            // Connected to a peer
            chatHeader.innerHTML = `
                <div class="chat-header-main">
                    <h3>Chat Room</h3>
                    <span class="connection-status connected">Connected</span>
                </div>
                ${roomId ? `
                <div class="chat-header-info">
                    <span class="room-id">Room: ${roomId}</span>
                    <span class="peer-name">Chatting with: ${peerNickname}</span>
                </div>
                ` : ''}
            `;
            chatControls.classList.remove('disabled');
            chatInput.disabled = false;
            sendMessageButton.disabled = false;
            chatInput.placeholder = 'Type your message...';
            
            // Update remote video overlay with peer's nickname
            if (remoteVideoOverlay) {
                remoteVideoOverlay.textContent = peerNickname;
            }
        } else if (socket && socket.connected) {
            // Connected to server but not to a peer
            chatHeader.innerHTML = `
                <div class="chat-header-main">
                    <h3>Chat Room</h3>
                    <span class="connection-status waiting">Waiting</span>
                </div>
            `;
            chatControls.classList.add('disabled');
            chatInput.disabled = true;
            sendMessageButton.disabled = true;
            chatInput.placeholder = 'Waiting for peer connection...';
            
            // Reset remote video overlay
            if (remoteVideoOverlay) {
                remoteVideoOverlay.textContent = 'Waiting...';
            }
        } else {
            // Not connected to server
            chatHeader.innerHTML = `
                <div class="chat-header-main">
                    <h3>Chat Room</h3>
                    <span class="connection-status disconnected">Disconnected</span>
                </div>
            `;
            chatControls.classList.add('disabled');
            chatInput.disabled = true;
            sendMessageButton.disabled = true;
            chatInput.placeholder = 'Connecting to server...';
            
            // Reset remote video overlay
            if (remoteVideoOverlay) {
                remoteVideoOverlay.textContent = 'Disconnected';
            }
        }
    }

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
        // Connect to Socket.IO server
        socket = io(config.SOCKET_SERVER, config.SOCKET_OPTIONS);

        socket.on('connect', () => {
            console.log('Connected to server:', socket.id);
            showSystemMessage('Connected to server');
            isConnected = true;
            updateConnectionStatus(false);
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            showSystemMessage('Connection error: ' + error.message);
            if (!isConnected) {
                setTimeout(() => socket.connect(), 2000);
            }
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            showSystemMessage('Disconnected from server');
            isConnected = false;
            updateConnectionStatus(false);
            handlePeerDisconnected();
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

        socket.on('peer-found', async ({ isInitiator: initiator, peerNickname, roomId }) => {
            isInitiator = initiator;
            currentRoomId = roomId;
            waitingScreen.classList.add('hidden');
            updateConnectionStatus(true, peerNickname, roomId);
            await startPeerConnection();
        });

        socket.on('signal', handleSignalingData);

        socket.on('peer-disconnected', () => {
            handlePeerDisconnected();
            updateConnectionStatus(false);
        });

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
            document.getElementById('startButton').disabled = false;
            
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
            userCount.textContent = `${count} online`;
        }
    }

    // Function to get ICE servers configuration
    async function getIceServers() {
        try {
            const response = await fetch(`${config.SOCKET_SERVER}/api/ice-servers`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error fetching ICE servers:', error);
            // Fallback to default ICE servers if fetch fails
            return {
                iceServers: [
                    {
                        urls: [
                            'stun:stun.l.google.com:19302',
                            'stun:stun1.l.google.com:19302',
                            'stun:stun2.l.google.com:19302'
                        ]
                    }
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

    // Function to start peer connection
    async function startPeerConnection() {
        try {
            // Get local stream if not already available
            if (!localStream) {
                localStream = await getLocalStream();
            }

            // Create and configure peer connection
            const configuration = await getIceServers();
            peerConnection = new RTCPeerConnection(configuration);

            // Add local stream tracks to peer connection
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });

            // Set up event handlers for peer connection
            peerConnection.ontrack = ({ streams: [stream] }) => {
                remoteVideo.srcObject = stream;
                showSystemMessage('Connected to peer');
            };

            peerConnection.onicecandidate = ({ candidate }) => {
                if (candidate) {
                    socket.emit('signal', { type: 'candidate', candidate });
                }
            };

            peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE Connection State:', peerConnection.iceConnectionState);
                if (peerConnection.iceConnectionState === 'disconnected') {
                    handlePeerDisconnected();
                }
            };

            // If we're the initiator, create and send the offer
            if (isInitiator) {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('signal', { type: 'offer', offer });
            }

            showSystemMessage('Starting peer connection...');
        } catch (error) {
            console.error('Error in startPeerConnection:', error);
            showSystemMessage('Failed to start peer connection: ' + error.message);
        }
    }

    // Handle signaling data
    async function handleSignalingData(data) {
        try {
            if (!peerConnection) {
                console.error('No peer connection available');
                return;
            }

            if (data.type === 'offer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('signal', { type: 'answer', answer });
            } else if (data.type === 'answer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.type === 'candidate') {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error('Error handling signaling data:', error);
            showSystemMessage('Signaling error: ' + error.message);
        }
    }

    // Handle start button click
    function handleStartClick() {
        if (!localStream) {
            getLocalStream().then(() => {
                startFindingPeer();
            }).catch(handleError);
        } else {
            startFindingPeer();
        }
        startButton.classList.add('hidden');
        stopButton.classList.remove('hidden');
    }

    // Start finding a peer
    function startFindingPeer() {
        // Clean up any existing connection
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        
        // Clear remote video
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }

        // Update UI
        updateConnectionStatus(false);
        const remoteVideoOverlay = document.querySelector('.remote-video-wrapper .video-overlay');
        if (remoteVideoOverlay) {
            remoteVideoOverlay.textContent = 'Waiting...';
        }

        // Emit find-peer event
        console.log('Looking for a peer...');
        socket.emit('find-peer');
    }

    // Handle stop button click
    function handleStopClick() {
        handlePeerDisconnected();
        socket.emit('leave-room');
        startButton.classList.remove('hidden');
        stopButton.classList.add('hidden');
    }

    // Handle peer disconnection
    function handlePeerDisconnected() {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (remoteVideo.srcObject) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
            remoteVideo.srcObject = null;
        }
        startButton.classList.remove('hidden');
        stopButton.classList.add('hidden');
        updateConnectionStatus(false);
    }

    // Event listeners
    startButton.addEventListener('click', handleStartClick);
    stopButton.addEventListener('click', handleStopClick);

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

    // Add message input handlers
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !chatInput.disabled) {
            e.preventDefault();
            sendMessageButton.click();
        }
    });

    sendMessageButton.addEventListener('click', () => {
        if (chatInput.disabled || !chatInput.value.trim()) return;
        
        const message = chatInput.value.trim();
        socket.emit('send-message', message);
        addMessageToChat(message, myNickname, true);
        chatInput.value = '';
    });

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
