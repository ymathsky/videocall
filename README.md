# Video Call Meeting System

A simple, robust 1-to-1 video calling application using Node.js, Socket.io, and WebRTC.

## Features
- Real-time video and audio communication
- Room-based joining (enter a room name to join)
- Mute audio / Hide video controls
- Simple and clean UI

## Prerequisites
- Node.js installed

## Setup
1.  Open the terminal in VS Code.
2.  Install dependencies:
    ```bash
    npm install
    ```

## Running the Application
### Option 1: VS Code Task
1.  Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac).
2.  Type `Tasks: Run Task`.
3.  Select `Run Video Call Server`.

### Option 2: Command Line
1.  Run the following command in the terminal:
    ```bash
    npm start
    ```

## Usage
1.  Open your browser and navigate to `http://localhost:3000`.
2.  Enter a Room Name (e.g., "Meeting1") and click **Join**.
3.  Open a second tab or window (or use another device on the same network).
4.  Navigate to `http://localhost:3000`.
5.  Enter the **SAME** Room Name and click **Join**.
6.  Grant camera/microphone permissions when prompted.
7.  The video call should start automatically!

## Admin Dashboard
1.  Navigate to `http://localhost:3000/admin`.
2.  Enter a Room Name (e.g., meeting123).
3.  Click **Generate Link**.
4.  Copy the generated link and share it with participants.

## Notes
-   This demo supports **2 participants per room**. If a third person tries to join, they will be alerting that the room is full.
-   Ensure both devices are on the same network if testing across devices, and replace `localhost` with your machine's local IP address (e.g., `192.168.1.5:3000`).
-   WebRTC requires HTTPS for non-localhost environments. To deploy this online, you will need SSL certificates.
