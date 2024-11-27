import StreamingViewer from './streaming-viewer.js';

class VideoChat {
    constructor() {
        // DOM Elements
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideosGrid = document.getElementById('remoteVideosGrid');
        this.startBtn = document.getElementById('startBtn');
        this.joinRandomBtn = document.getElementById('joinRandomBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        this.muteAudioBtn = document.getElementById('muteAudioBtn');
        this.muteVideoBtn = document.getElementById('muteVideoBtn');
        this.shareScreenBtn = document.getElementById('shareScreenBtn');
        this.viewerCount = document.getElementById('viewerCount');
        this.streamDuration = document.getElementById('streamDuration');

        // State
        this.isStreaming = false;
        this.isScreenSharing = false;
        this.streamStartTime = null;
        this.durationTimer = null;
        this.streamingViewer = null;

        // Bind event listeners
        this.startBtn.addEventListener('click', () => this.toggleStreaming());
        this.joinRandomBtn.addEventListener('click', () => this.autoJoinRoom());
        this.leaveBtn.addEventListener('click', () => this.leaveRoom());
        this.muteAudioBtn.addEventListener('click', () => this.toggleAudio());
        this.muteVideoBtn.addEventListener('click', () => this.toggleVideo());
        this.shareScreenBtn.addEventListener('click', () => this.toggleScreenShare());

        // Initialize streaming components and auto-join
        this.initialize();
    }

    async initialize() {
        try {
            // Initialize streaming components
            this.streamingViewer = new StreamingViewer();
            await this.streamingViewer.initializeWebSocket();

            // Enable buttons after initialization
            this.startBtn.disabled = false;
            this.joinRandomBtn.disabled = false;

            // Set up host count update handler
            this.streamingViewer.onHostCountUpdate = (count) => {
                this.updateHostCount(count);
            };

        } catch (error) {
            console.error('Failed to initialize:', error);
            this.showError('Failed to initialize video chat. Please refresh the page.');
        }
    }

    async toggleStreaming() {
        try {
            if (!this.isStreaming) {
                // Become a host
                const stream = await this.streamingViewer.becomeHost();
                
                if (stream) {
                    this.localVideo.srcObject = stream;
                    this.isStreaming = true;
                    this.startStreamTimer();
                    this.updateUI();
                }
            } else {
                await this.stopStreaming();
            }
        } catch (error) {
            console.error('Error toggling streaming:', error);
            this.showError('Failed to toggle streaming. Please try again.');
        }
    }

    async autoJoinRoom() {
        try {
            // Join the room as a viewer
            const { stream } = await this.streamingViewer.joinRoom();
            
            if (stream) {
                // Create a new video element for the remote stream
                const videoElement = document.createElement('video');
                videoElement.autoplay = true;
                videoElement.playsInline = true;
                videoElement.srcObject = stream;
                
                // Add the video element to the grid
                const videoContainer = document.createElement('div');
                videoContainer.className = 'video-box';
                const videoLabel = document.createElement('div');
                videoLabel.className = 'video-label';
                videoLabel.innerHTML = '<i class="fas fa-user"></i><span>Host</span>';
                videoContainer.appendChild(videoElement);
                videoContainer.appendChild(videoLabel);
                this.remoteVideosGrid.appendChild(videoContainer);

                // Update UI
                this.joinRandomBtn.disabled = true;
                this.leaveBtn.disabled = false;
                this.updateUI();
            }
        } catch (error) {
            console.error('Error joining room:', error);
            this.showError('Failed to join room. Please try again.');
        }
    }

    async stopStreaming() {
        if (this.streamingViewer) {
            this.streamingViewer.leaveRoom();
        }
        
        if (this.localVideo.srcObject) {
            this.localVideo.srcObject.getTracks().forEach(track => track.stop());
            this.localVideo.srcObject = null;
        }

        this.isStreaming = false;
        this.stopStreamTimer();
        this.updateUI();
    }

    async leaveRoom() {
        try {
            if (this.streamingViewer) {
                this.streamingViewer.leaveRoom();
            }

            // Clear remote videos
            while (this.remoteVideosGrid.firstChild) {
                this.remoteVideosGrid.removeChild(this.remoteVideosGrid.firstChild);
            }

            // Reset UI
            this.joinRandomBtn.disabled = false;
            this.leaveBtn.disabled = true;
            this.updateUI();
        } catch (error) {
            console.error('Error leaving room:', error);
            this.showError('Failed to leave room. Please try again.');
        }
    }

    async toggleAudio() {
        if (this.localVideo.srcObject) {
            const audioTrack = this.localVideo.srcObject.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.muteAudioBtn.innerHTML = audioTrack.enabled ? 
                    '<i class="fas fa-microphone"></i>' : 
                    '<i class="fas fa-microphone-slash"></i>';
            }
        }
    }

    async toggleVideo() {
        if (this.localVideo.srcObject) {
            const videoTrack = this.localVideo.srcObject.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.muteVideoBtn.innerHTML = videoTrack.enabled ? 
                    '<i class="fas fa-video"></i>' : 
                    '<i class="fas fa-video-slash"></i>';
            }
        }
    }

    async toggleScreenShare() {
        try {
            if (!this.isScreenSharing) {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({
                    video: {
                        cursor: "always"
                    },
                    audio: false
                });

                const videoTrack = screenStream.getVideoTracks()[0];
                
                videoTrack.onended = () => {
                    this.stopScreenSharing();
                };

                if (this.localVideo.srcObject) {
                    const sender = this.streamingViewer.peerConnection
                        .getSenders()
                        .find(s => s.track.kind === 'video');
                    
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }

                    this.localVideo.srcObject.getVideoTracks()[0].stop();
                    const audioTrack = this.localVideo.srcObject.getAudioTracks()[0];
                    
                    const newStream = new MediaStream([videoTrack]);
                    if (audioTrack) {
                        newStream.addTrack(audioTrack);
                    }
                    
                    this.localVideo.srcObject = newStream;
                }

                this.isScreenSharing = true;
                this.shareScreenBtn.innerHTML = '<i class="fas fa-desktop"></i> Stop Sharing';
            } else {
                await this.stopScreenSharing();
            }
        } catch (error) {
            console.error('Error toggling screen share:', error);
            this.showError('Failed to toggle screen sharing. Please try again.');
        }
    }

    async stopScreenSharing() {
        try {
            if (this.isScreenSharing) {
                // Get a new video stream from the camera
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: this.localVideo.srcObject.getAudioTracks().length > 0
                });

                const videoTrack = newStream.getVideoTracks()[0];
                
                if (this.streamingViewer.peerConnection) {
                    const sender = this.streamingViewer.peerConnection
                        .getSenders()
                        .find(s => s.track.kind === 'video');
                    
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }
                }

                // Stop all tracks in the current stream
                if (this.localVideo.srcObject) {
                    this.localVideo.srcObject.getTracks().forEach(track => track.stop());
                }

                // Set up the new stream
                const audioTrack = newStream.getAudioTracks()[0];
                const stream = new MediaStream([videoTrack]);
                if (audioTrack) {
                    stream.addTrack(audioTrack);
                }
                
                this.localVideo.srcObject = stream;
                this.isScreenSharing = false;
                this.shareScreenBtn.innerHTML = '<i class="fas fa-desktop"></i>';
            }
        } catch (error) {
            console.error('Error stopping screen share:', error);
            this.showError('Failed to stop screen sharing. Please try again.');
        }
    }

    startStreamTimer() {
        this.streamStartTime = Date.now();
        this.updateStreamDuration();
        this.durationTimer = setInterval(() => this.updateStreamDuration(), 1000);
    }

    stopStreamTimer() {
        if (this.durationTimer) {
            clearInterval(this.durationTimer);
            this.durationTimer = null;
        }
        this.streamStartTime = null;
        this.streamDuration.textContent = '00:00';
    }

    updateStreamDuration() {
        if (!this.streamStartTime) return;

        const duration = Math.floor((Date.now() - this.streamStartTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        this.streamDuration.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    updateHostCount(count) {
        this.viewerCount.textContent = count.toString();
    }

    updateUI() {
        // Update button states
        this.startBtn.textContent = this.isStreaming ? 'Stop Streaming' : 'Become Host';
        this.muteAudioBtn.disabled = !this.isStreaming;
        this.muteVideoBtn.disabled = !this.isStreaming;
        this.shareScreenBtn.disabled = !this.isStreaming;
        this.joinRandomBtn.disabled = this.isStreaming;
        this.leaveBtn.disabled = !this.isStreaming;

        // Update local video container visibility
        if (this.localVideo.parentElement) {
            this.localVideo.parentElement.style.display = this.isStreaming ? 'block' : 'none';
        }
    }

    showError(message) {
        // You can implement a more sophisticated error display mechanism
        alert(message);
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VideoChat();
});
