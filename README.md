# Video Chat App

A public video chat application similar to Omegle, built with WebRTC and Cloudflare Workers. This application allows multiple participants to join video chat rooms, similar to Google Meet but for public use.

## Features

- Public video chat rooms
- Multiple participants per room (up to 8)
- Audio and video controls
- Real-time communication using WebRTC
- Scalable signaling server using Cloudflare Workers
- Modern and responsive UI

## Prerequisites

- Node.js and npm installed
- A Cloudflare account for deploying the Worker
- Wrangler CLI installed (`npm install -g wrangler`)

## Project Structure

```
video-chat-app/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── main.js
│       └── webrtc.js
├── worker/
│   └── index.js
├── package.json
└── README.md
```

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Deploy the Cloudflare Worker:
   ```bash
   cd worker
   wrangler publish
   ```

3. Update the WebSocket URL in `public/js/webrtc.js` with your Cloudflare Worker URL:
   ```javascript
   this.ws = new WebSocket('wss://your-worker.your-subdomain.workers.dev');
   ```

4. Start the local development server:
   ```bash
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. Click the "Start New Chat" button to join a room
2. Grant camera and microphone permissions when prompted
3. Use the audio and video controls to manage your media streams
4. Click "Leave Room" to disconnect from the current chat

## Security Considerations

- The application uses STUN servers for NAT traversal
- Consider adding TURN servers for better connectivity
- Implement rate limiting and other security measures in the Cloudflare Worker
- Add content moderation features for public chat rooms

## Contributing

Feel free to submit issues and pull requests.

## License

MIT License
