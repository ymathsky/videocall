# Video Call Meeting System Instructions

## Project Overview
This is a 1-to-1 video calling application using Node.js, Express, Socket.io, and WebRTC. It includes a main meeting interface, an admin dashboard, and a consent form. The backend uses SQLite for data persistence.

## Architecture & Core Components

### Backend (`server.js`)
- **Express Server:** Serves static files from root and specific routes (`/admin`, `/consent`).
- **Socket.io:** Handles WebRTC signaling (join, offer, answer, ice-candidate).
- **SQLite3:** Persists meeting and consent data in `videocall.db`.
- **Database Schema:**
  - `meetings`: Stores room names and creation timestamps.
  - `consents`: Stores user consent signatures.

### Frontend (`script.js` & `index.html`)
- **WebRTC Logic:**
  - Uses `RTCPeerConnection` for P2P media streaming.
  - Uses Google's public STUN servers for NAT traversal (`stun:stun.l.google.com:19302`).
  - Implements manual signaling flow: `join` -> `ready` -> `offer` -> `answer` -> `candidate`.
- **UI:** Vanilla JS DOM manipulation. No frontend framework (React/Vue/etc.).

### Deployment (`DEPLOYMENT.md`)
- Optimized for cPanel shared hosting with Node.js support.
- Requires `server.js` as the startup file.
- **Important:** Do NOT upload `node_modules` during deployment; install via cPanel UI.

## Development Workflow

### Running the App
- **Start Server:** `npm start` (Runs `node server.js`).
- **Access App:** `http://localhost:3000`.
- **Testing:** Open two browser tabs or distinct browsers to simulate two users connecting to the same room.

### Debugging
- **Server Logs:** Check terminal for Socket.io connection events (`User joined...`).
- **Client Logs:** Use browser console to debug WebRTC state changes and socket events.

## Conventions & Patterns

### Signaling Flow
1.  **Join:** User emits `join` with room name.
2.  **Room Logic:**
    -   1st user: Room 'created'.
    -   2nd user: Room 'joined', emits 'ready'.
    -   3rd+ user: 'full'.
3.  **Offer/Answer:**
    -   'ready' event triggers the creator to create an offer.
    -   Offer sent via `socket.emit('offer', ...)` broadcasts to room.
    -   Recipient creates answer and emits `socket.emit('answer', ...)`.
    -   ICE candidates exchanged via `socket.emit('candidate', ...)`.

### Database Access
- Use `sqlite3` verbose mode.
- Initialization occurs on server start.
- Ensure `videocall.db` is writable.

### Asset Management
- Static files (`style.css`, client JS) are served from the root directory using `express.static(__dirname)`.
