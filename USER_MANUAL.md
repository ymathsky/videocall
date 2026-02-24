

## Using the Main Interface

### 1. Start a New Meeting
1.  On the home page, look for the **Start a New Meeting** section.
2.  **(Optional)** Enter a **Room Password** in the input field. Leave it blank if you want an open meeting.
3.  Click the **Create Secure Meeting** button.
4.  You will be redirected to the video call room.

### 2. Join a Meeting
1.  On the home page, look for the **Join a Meeting** section.
2.  Enter the **Meeting ID** or **Link** provided by the host.
3.  Enter the **Room Password** (if the room is password-protected).
4.  Click **Join Meeting**.
5.  If the host has enabled a waiting room, you may see a "Waiting Room" screen until admitted.

---

## In-Call Features
Once you are in a meeting, you will see the video grid and a control bar at the bottom.

### Video & Audio Controls
- **Microphone Icon**: Click to **Mute** or **Unmute** your audio.
- **Camera Icon**: Click to **Turn Off** or **Turn On** your camera.

### Collaboration Tools
- **Screen Share Icon**: Click to share your screen with the other participant. You can choose to share your entire screen, a specific window, or a browser tab.
- **Chat Icon**: Click to open the **Meeting Chat** panel on the right. You can type and send text messages to the other participant.

### Meeting Management
- **Invite Icon (User Plus)**: Click to copy the **Invite Link** to your clipboard. Share this link with the person you want to invite.
- **Phone Icon (Red)**: Click to **Leave** the call.

---

## Admin Dashboard
The Admin Dashboard allows for meeting management and access to patient consent forms.

### Login
1.  Navigate to `/admin`.
2.  Enter the admin **Username** and **Password**.
3.  Click **Login** to access the dashboard.

> Default credentials: `admin` / `admin123` (recommended to change via environment variables).


### Features
1.  **Sidebar Navigation**:
    *   Use the left sidebar to switch between **Create Meeting**, **Recent Meetings**, and **Consent Forms**.
    *   Use **Logout** to securely end the admin session.
2.  **Patient Consent Form**:
    *   Click **View Form** to verify the consent document.
    *   Click **Copy Link** to copy the URL of the consent form to send to patients/clients.
3.  **Create New Meeting**:
    *   Enter a **Meeting Topic / Room Name**.
    *   Click **Generate Meeting Link**.
    *   Copy the generated link to share.

---

## Digital Consent Form
The system includes a built-in consent form for users (e.g., patients in a telehealth context).

**Access**: Navigate to `/consent` or use the link provided by the administrator.

### How to Fill Out
1.  **Personal Information**: Enter your **Full Name**, **Date of Birth**, **Email Address**, and **Phone Number**.
2.  **Read Consent**: Review the terms and conditions listed in the consent text.
3.  **Signature**: Use your mouse or touch screen to sign in the **Signature Pad** area.
    *   Use the **Clear** button if you need to re-sign.
4.  **Submit**: Click **I Consent & Submit** to finalize the form.

---

## Troubleshooting

### Camera/Microphone Not Working
- Ensure you have granted the browser permission to access your camera and microphone.
- Check if another application is currently using the camera (e.g., Zoom, Teams).
- Refresh the page and try again.

### Connection Issues
- Ensure you are connected to the internet.
- If you are on a restricted network (e.g., corporate firewall), some WebRTC connections might be blocked. Try using a different network or mobile data.
- If the other person cannot see/hear you, ask them to check their permissions as well.

### Echo/Audio Feedback
- Use headphones to prevent audio from your speakers feeding back into your microphone.
