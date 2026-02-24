const socket = io();
const roomSelectionContainer = document.getElementById('room-selection-container');
const roomInput = document.getElementById('room-input');
const connectButton = document.getElementById('connect-button');
const createButton = document.getElementById('create-button');
const createPasswordInput = document.getElementById('create-password-input');
const joinPasswordInput = document.getElementById('join-password-input');
const waitingRoomOverlay = document.getElementById('waiting-room-overlay');
const hostNotifications = document.getElementById('host-notifications');

// Add "Enter" key support for joining
roomInput.addEventListener("keypress", function(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    connectButton.click();
  }
});

// Generate a random UUID for secure rooms
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

createButton.addEventListener('click', () => {
    roomName = generateUUID();
    const password = createPasswordInput.value;
    
    // Update URL without reloading
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + encodeURIComponent(roomName);
    window.history.pushState({path:newUrl},'',newUrl);

    document.getElementById('room-display-name').innerText = "Room: " + roomName.substring(0, 8) + "...";
    socket.emit('create-room', roomName, password);
});

connectButton.addEventListener('click', () => {
    roomName = roomInput.value;
    const password = joinPasswordInput.value;
    
    if (roomName === '') {
        alert('Please enter a room ID or link');
        return;
    }
    
    // Update URL without reloading
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + encodeURIComponent(roomName);
    window.history.pushState({path:newUrl},'',newUrl);

    document.getElementById('room-display-name').innerText = "Room: " + roomName.substring(0, 8) + "...";
    socket.emit('join-request', roomName, password, ''); // no token for manual join
});

const videoChatContainer = document.getElementById('video-chat-container');
const userVideo = document.getElementById('user-video');
const videoGrid = document.querySelector('.video-grid'); // Fixed selector to handle dynamic elements

const muteButton = document.getElementById('mute-button');
const hideCameraButton = document.getElementById('hide-camera-button');
const shareScreenButton = document.getElementById('share-screen-button');
const inviteButton = document.getElementById('invite-button');
const leaveButton = document.getElementById('leave-button');
const chatToggleButton = document.getElementById('chat-toggle-button');
const chatContainer = document.getElementById('chat-container');
const chatCloseBtn = document.getElementById('chat-close-btn');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatMessages = document.getElementById('chat-messages');

let roomName;
let localStream;
let urlRoomPwd   = ''; // password from URL ?pwd= param (legacy / host links)
let urlJoinToken = ''; // one-time consent token from URL ?token= param
let isAutoJoin   = false; // true when joining via a direct ?room= URL
let isHost       = false; // true when this client is the meeting host
let displayName  = localStorage.getItem('vc_display_name') || '';
let callStartTime   = null;
let timerInterval   = null;
let qualityInterval = null;
let handRaised      = false;
let stream = localStream; // keep reference to current stream (camera or screen)
const peers = {}; // Connection store: socketId -> RTCPeerConnection
const peerVideos = {}; // DOM elements: socketId -> videoElement
let isAudioMuted = false;
let isVideoOff = false;
let isSharingScreen = false;
let isChatOpen = false;

// STUN + TURN servers for NAT traversal (TURN required for mobile/5G symmetric NAT)
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

// Auto-join if room parameter exists
window.onload = () => {
    const urlParams    = new URLSearchParams(window.location.search);
    const roomParam    = urlParams.get('room');
    const isHostParam  = urlParams.get('host') === '1';
    urlRoomPwd   = urlParams.get('pwd')   || '';
    urlJoinToken = urlParams.get('token') || '';

    if (roomParam) {
        roomName = roomParam;
        isAutoJoin = true;
        document.getElementById('room-display-name').innerText = roomParam;
        document.getElementById('room-selection-container').style.display = 'none';

        const proceed = () => {
            if (isHostParam) {
                isHost = true;
                setTimeout(() => { socket.emit('create-room', roomParam, displayName); }, 200);
            } else {
                showPasswordModal();
            }
        };

        if (!displayName) {
            showNameModal(proceed);
        } else {
            proceed();
        }
    }
};

/* ─── Name modal ─── */
function showNameModal(callback) {
    const modal = document.getElementById('name-modal');
    const input = document.getElementById('name-modal-input');
    input.value = displayName;
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
    const submit = () => {
        const name = input.value.trim() || 'Anonymous';
        displayName = name;
        localStorage.setItem('vc_display_name', name);
        modal.style.display = 'none';
        callback();
    };
    document.getElementById('name-modal-submit').onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

/* ─── Password modal ─── */
function showPasswordModal(errorMsg) {
    const modal = document.getElementById('pwd-modal');
    const errorEl = document.getElementById('pwd-modal-error');
    if (errorMsg) {
        errorEl.textContent = errorMsg;
        document.getElementById('pwd-modal-input').select();
    } else {
        errorEl.textContent = '';
    }
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('pwd-modal-input').focus(), 100);
}

function hidePasswordModal() {
    document.getElementById('pwd-modal').style.display = 'none';
}

function submitPasswordModal() {
    const pwd = document.getElementById('pwd-modal-input').value;
    if (!pwd.trim()) {
        document.getElementById('pwd-modal-error').textContent = 'Please enter the meeting password.';
        return;
    }
    hidePasswordModal();
    document.getElementById('room-selection-container').style.display = 'none';
    socket.emit('join-request', roomName, pwd.trim(), urlJoinToken, displayName);
}

document.getElementById('pwd-modal-submit').addEventListener('click', submitPasswordModal);
document.getElementById('pwd-modal-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPasswordModal();
});

connectButton.addEventListener('click', () => {
    roomName = roomInput.value;
    if (roomName === '') {
        alert('Please enter a room name');
        return;
    }
    
    // Update URL without reloading
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + encodeURIComponent(roomName);
    window.history.pushState({path:newUrl},'',newUrl);

    document.getElementById('room-display-name').innerText = roomName; // Update header
    socket.emit('join', roomName);
});

inviteButton.addEventListener('click', () => {
    const inviteLink = window.location.origin + '?room=' + encodeURIComponent(roomName);
    navigator.clipboard.writeText(inviteLink).then(() => {
        showToast("Link copied to clipboard!");
    });
});

function showToast(message) {
    // Create toast element if it doesn't exist
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        document.body.appendChild(toast);
    }
    toast.innerText = message;
    toast.className = "show";
    setTimeout(function(){ toast.className = toast.className.replace("show", ""); }, 3000);
}

muteButton.addEventListener('click', () => {
    isAudioMuted = !isAudioMuted;
    localStream.getAudioTracks()[0].enabled = !isAudioMuted;
    muteButton.classList.toggle('active');
    
    // Toggle Icon
    const icon = muteButton.querySelector('i');
    if (isAudioMuted) {
        icon.classList.remove('fa-microphone');
        icon.classList.add('fa-microphone-slash');
    } else {
        icon.classList.remove('fa-microphone-slash');
        icon.classList.add('fa-microphone');
    }
});

hideCameraButton.addEventListener('click', () => {
    isVideoOff = !isVideoOff;
    localStream.getVideoTracks()[0].enabled = !isVideoOff;
    hideCameraButton.classList.toggle('active');

    // Toggle Icon
    const icon = hideCameraButton.querySelector('i');
    if (isVideoOff) {
        icon.classList.remove('fa-video');
        icon.classList.add('fa-video-slash');
    } else {
        icon.classList.remove('fa-video-slash');
        icon.classList.add('fa-video');
    }
});

shareScreenButton.addEventListener('click', () => {
    if (isSharingScreen) {
        stopScreenSharing();
    } else {
        startScreenSharing();
    }
});

function stopScreenSharing() {
    isSharingScreen = false;
    shareScreenButton.classList.remove('active');
    
    // Switch back to camera track
    const videoTrack = localStream.getVideoTracks()[0];
    
    Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track.kind === 'video');
        if(sender) sender.replaceTrack(videoTrack);
    });
    
    userVideo.srcObject = localStream;
}

// Helper to switch between screen sharing and camera
async function startScreenSharing() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        isSharingScreen = true;
        shareScreenButton.classList.add('active');

        const screenTrack = screenStream.getVideoTracks()[0];

        // Handle user clicking "Stop Sharing" on browser UI
        screenTrack.onended = () => {
            stopScreenSharing();
        };

        Object.values(peers).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track.kind === 'video');
            if(sender) sender.replaceTrack(screenTrack);
        });

        userVideo.srcObject = screenStream;
    } catch (err) {
        console.error("Error sharing screen: ", err);
    }
}

shareScreenButton.addEventListener('click', () => {
    if (isSharingScreen) {
        stopScreenSharing();
    } else {
        startScreenSharing();
    }
});

chatToggleButton.addEventListener('click', () => {
    isChatOpen = !isChatOpen;
    chatContainer.classList.toggle('visible');
    if (isChatOpen) {
        chatInput.focus();
    }
});

chatCloseBtn.addEventListener('click', () => {
    isChatOpen = false;
    chatContainer.classList.remove('visible');
});

function sendMessage() {
    const message = chatInput.value;
    if (message.trim() !== '') {
        const msgData = {
            message: message,
            senderName: displayName || 'You',
            timestamp: new Date().toISOString()
        };
        addMessageToChat(msgData, true);
        socket.emit('chat-message', message, roomName);
        chatInput.value = '';
    }
}

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

socket.on('chat-message', (data) => {
    // data can be a plain string (legacy) or an enriched object
    const normalized = (typeof data === 'string')
        ? { message: data, senderName: 'Peer', timestamp: new Date().toISOString() }
        : data;
    addMessageToChat(normalized, false);
    // Auto-open chat if closed
    if (!isChatOpen) {
        isChatOpen = true;
        chatContainer.classList.add('visible');
    }
});

function addMessageToChat(data, isMyMessage) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    if (isMyMessage) msgDiv.classList.add('my-message');
    const name = isMyMessage ? (displayName || 'You') : (data.senderName || 'Peer');
    const time = data.timestamp
        ? new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        : new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    msgDiv.innerHTML = `
        <span class="message-sender">${name} &bull; ${time}</span>
        ${data.message}
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

leaveButton.addEventListener('click', () => {
    localStorage.removeItem('vc_timer_' + roomName);
    location.reload();
});

socket.on('room-error', (message) => {
    alert(message || 'Meeting error. Please contact your provider.');
});

/* ─── Device Check ─── */
let _dcStream    = null;
let _dcAudioCtx  = null;
let _dcAnimFrame = null;

function _dcStopResources() {
    if (_dcAnimFrame) { cancelAnimationFrame(_dcAnimFrame); _dcAnimFrame = null; }
    if (_dcAudioCtx)  { _dcAudioCtx.close().catch(()=>{}); _dcAudioCtx = null; }
}

function _dcStartMicMeter(stream) {
    try {
        const ctx      = new (window.AudioContext || window.webkitAudioContext)();
        const src      = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const fill = document.getElementById('dc-mic-bar-fill');
        function tick() {
            _dcAnimFrame = requestAnimationFrame(tick);
            analyser.getByteFrequencyData(data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            if (fill) fill.style.width = Math.min(100, avg * 2.5) + '%';
        }
        tick();
        _dcAudioCtx = ctx;
    } catch(e) {}
}

async function showDeviceCheck(callback) {
    const modal     = document.getElementById('device-check-modal');
    const preview   = document.getElementById('dc-preview');
    const noCamera  = document.getElementById('dc-no-camera');
    const camStatus = document.getElementById('dc-cam-status');
    const micStatus = document.getElementById('dc-mic-status');
    const camSel    = document.getElementById('dc-cam-select');
    const micSel    = document.getElementById('dc-mic-select');
    const joinBtn   = document.getElementById('dc-join-btn');
    const cancelBtn = document.getElementById('dc-cancel-btn');

    // Reset UI
    _dcStopResources();
    if (_dcStream) { _dcStream.getTracks().forEach(t => t.stop()); _dcStream = null; }
    camStatus.className = 'dc-status-badge dc-checking';
    camStatus.querySelector('span').textContent = 'Checking camera\u2026';
    micStatus.className = 'dc-status-badge dc-checking';
    micStatus.querySelector('span').textContent = 'Checking mic\u2026';
    if (preview) { preview.srcObject = null; preview.style.display = 'block'; }
    if (noCamera) noCamera.style.display = 'none';
    if (camSel) camSel.innerHTML = '';
    if (micSel) micSel.innerHTML = '';
    if (joinBtn) joinBtn.disabled = false;
    const fill = document.getElementById('dc-mic-bar-fill');
    if (fill) fill.style.width = '0%';

    modal.style.display = 'flex';

    async function startStream(videoId, audioId) {
        _dcStopResources();
        if (_dcStream) { _dcStream.getTracks().forEach(t => t.stop()); _dcStream = null; }

        const constraints = {
            video: videoId ? { deviceId: { exact: videoId } } : true,
            audio: audioId ? { deviceId: { exact: audioId } } : true,
        };
        try {
            _dcStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch(e) {
            // Fallback: try audio-only
            try { _dcStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
            catch(e2) { _dcStream = null; }
        }

        const hasCam = _dcStream && _dcStream.getVideoTracks().length > 0;
        const hasMic = _dcStream && _dcStream.getAudioTracks().length > 0;

        if (hasCam) {
            preview.srcObject = _dcStream;
            preview.style.display = 'block';
            noCamera.style.display = 'none';
            camStatus.className = 'dc-status-badge dc-ok';
            camStatus.querySelector('span').textContent = 'Camera ready';
        } else {
            if (preview) preview.style.display = 'none';
            noCamera.style.display = 'flex';
            camStatus.className = 'dc-status-badge dc-fail';
            camStatus.querySelector('span').textContent = 'No camera';
        }

        if (hasMic) {
            micStatus.className = 'dc-status-badge dc-ok';
            micStatus.querySelector('span').textContent = 'Microphone ready';
            _dcStartMicMeter(_dcStream);
        } else {
            micStatus.className = 'dc-status-badge dc-fail';
            micStatus.querySelector('span').textContent = 'No microphone';
        }
    }

    async function populateDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(d => d.kind === 'videoinput');
            const mics    = devices.filter(d => d.kind === 'audioinput');

            camSel.innerHTML = cameras.length
                ? cameras.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i+1)}</option>`).join('')
                : '<option value="">No cameras found</option>';
            micSel.innerHTML = mics.length
                ? mics.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Microphone ' + (i+1)}</option>`).join('')
                : '<option value="">No microphones found</option>';

            // Select current device
            if (_dcStream) {
                const vt = _dcStream.getVideoTracks()[0];
                const at = _dcStream.getAudioTracks()[0];
                if (vt) { const id = vt.getSettings().deviceId; if (id) camSel.value = id; }
                if (at) { const id = at.getSettings().deviceId; if (id) micSel.value = id; }
            }
        } catch(e) {}
    }

    await startStream(null, null);
    await populateDevices();

    camSel.onchange = () => startStream(camSel.value || null, micSel.value || null);
    micSel.onchange = () => startStream(camSel.value || null, micSel.value || null);

    // Replace previous listeners to avoid stacking
    const newJoin   = joinBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    joinBtn.replaceWith(newJoin);
    cancelBtn.replaceWith(newCancel);

    newJoin.addEventListener('click', () => {
        _dcStopResources();
        modal.style.display = 'none';
        const s = _dcStream;
        _dcStream = null;
        callback(s);
    });

    newCancel.addEventListener('click', () => {
        _dcStopResources();
        if (_dcStream) { _dcStream.getTracks().forEach(t => t.stop()); _dcStream = null; }
        modal.style.display = 'none';
        // Allow user to return to home
        location.reload();
    });
}

socket.on('created', () => {
    isHost = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support camera access or requires HTTPS.');
        return;
    }
    roomSelectionContainer.style = 'display:none';
    showDeviceCheck((stream) => {
        if (!stream) {
            alert('Could not access your camera or microphone. Please grant permissions and try again.');
            location.reload();
            return;
        }
        localStream = stream;
        userVideo.srcObject = stream;
        videoChatContainer.style = 'display:block';
        startCallSession();
        updateVideoGridLayout();
    });
});

socket.on('join-error', (message) => {
    if (message === 'Incorrect password.' && isAutoJoin) {
        // Re-show password modal with error
        document.getElementById('pwd-modal-input').value = '';
        showPasswordModal('Incorrect password. Please try again.');
        return;
    }

    if (message === 'Room does not exist.' && isAutoJoin) {
        // Host hasn't started yet — show friendly overlay then re-prompt after 5s
        const overlay = document.getElementById('waiting-room-overlay');
        const icon    = document.getElementById('waiting-icon');
        const title   = document.getElementById('waiting-title');
        const msg     = document.getElementById('waiting-message');
        const sub     = document.getElementById('waiting-sub');

        if (icon)  { icon.className = 'fas fa-clock'; }
        if (title) title.textContent = 'Your Provider Hasn\'t Started Yet';
        if (msg)   msg.innerHTML  = 'Please wait. You will be automatically connected<br>once your provider opens the session.';
        if (sub)   { sub.style.display = 'block'; sub.textContent = 'Will re-prompt for password once room is ready…'; }
        overlay.style.display = 'flex';

        // After 5s hide overlay and re-show password modal so user can try again
        const retryTimer = setTimeout(() => {
            overlay.style.display = 'none';
            showPasswordModal();
        }, 5000);

        socket.once('waiting-room', () => clearTimeout(retryTimer));
        socket.once('admitted',     () => clearTimeout(retryTimer));
    } else {
        alert(message);
    }
});

socket.on('waiting-room', () => {
    const icon  = document.getElementById('waiting-icon');
    const title = document.getElementById('waiting-title');
    const msg   = document.getElementById('waiting-message');
    const sub   = document.getElementById('waiting-sub');
    if (icon)  icon.className = 'fas fa-hourglass-half';
    if (title) title.textContent = 'Waiting Room';
    if (msg)   msg.innerHTML = "You're in the waiting room.<br>Please wait for the provider to admit you.";
    if (sub)   sub.style.display = 'none';
    roomSelectionContainer.style = 'display:none';
    waitingRoomOverlay.style = 'display:flex';
});

socket.on('guest-waiting', (data) => {
    const notification = document.createElement('div');
    notification.className = 'notification-card';
    notification.id = `notif-${data.socketId}`;
    notification.innerHTML = `
        <div><strong>${data.name || 'Patient'} wants to join</strong></div>
        <div class="notification-actions">
            <button class="btn-admit" onclick="admitGuest('${data.socketId}', '${data.roomName}')">Admit</button>
            <button class="btn-deny" onclick="denyGuest('${data.socketId}')">Deny</button>
        </div>
    `;
    hostNotifications.appendChild(notification);
});

window.admitGuest = function(socketId, roomName) {
    socket.emit('admit-guest', socketId, roomName);
    document.getElementById(`notif-${socketId}`).remove();
};

window.denyGuest = function(socketId) {
    socket.emit('deny-guest', socketId);
    document.getElementById(`notif-${socketId}`).remove();
};

socket.on('denied', () => {
    alert('The host denied your request to join.');
    location.reload();
});

socket.on('admitted', () => {
    waitingRoomOverlay.style = 'display:none';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support camera access or requires HTTPS.');
        return;
    }
    showDeviceCheck((stream) => {
        if (!stream) {
            alert('Could not access your camera or microphone. Please grant permissions and try again.');
            location.reload();
            return;
        }
        localStream = stream;
        userVideo.srcObject = stream;
        videoChatContainer.style = 'display:block';
        startCallSession();
        updateVideoGridLayout();
        socket.emit('ready', roomName);
        if (displayName) socket.emit('user-name', roomName, displayName);
    });
});

socket.on('ready', (socketId) => {
    // New user joined, existing users initiate connection
    createPeerConnection(socketId, true);
    // Share our name with the new peer
    if (displayName) socket.emit('user-name', roomName, displayName);
});

socket.on('offer', (offer, socketId) => {
    // Receive offer, create peer connection and answer
    createPeerConnection(socketId, false);
    peers[socketId].setRemoteDescription(offer);
    peers[socketId].createAnswer()
        .then((answer) => {
            peers[socketId].setLocalDescription(answer);
            socket.emit('answer', answer, roomName, socketId); 
        });
});

socket.on('answer', (answer, socketId) => {
    if (peers[socketId]) {
        peers[socketId].setRemoteDescription(answer);
    }
});

socket.on('candidate', (candidate, socketId) => {
    if (peers[socketId]) {
        peers[socketId].addIceCandidate(candidate);
    }
});

socket.on('user-disconnected', (socketId) => {
    if (peers[socketId]) {
        peers[socketId].close();
        delete peers[socketId];
    }
    if (peerVideos[socketId]) {
        peerVideos[socketId].remove();
        delete peerVideos[socketId];
    }
    updateVideoGridLayout();
});

function createPeerConnection(socketId, isInitiator) {
    if (peers[socketId]) return; // Already exists

    const pc = new RTCPeerConnection(iceServers);
    peers[socketId] = pc;

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('candidate', event.candidate, roomName, socketId);
        }
    };

    pc.ontrack = (event) => {
        if (!peerVideos[socketId]) {
            createVideoElement(socketId, event.streams[0]);
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    if (isInitiator) {
        pc.createOffer()
            .then((offer) => {
                pc.setLocalDescription(offer);
                socket.emit('offer', offer, roomName, socketId);
            })
            .catch(console.error);
    }
}

function createVideoElement(socketId, stream) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('video-wrapper');
    wrapper.id = `wrapper-${socketId}`;

    const video = document.createElement('video');
    video.id = `video-${socketId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const nameTag = document.createElement('div');
    nameTag.classList.add('name-tag');
    nameTag.innerText = 'Connecting…';

    wrapper.appendChild(video);
    wrapper.appendChild(nameTag);
    document.querySelector('.video-grid').appendChild(wrapper);

    peerVideos[socketId] = wrapper;
    updateVideoGridLayout();
}

/* Update .video-grid count class so CSS applies the right tile widths */
function updateVideoGridLayout() {
    const grid = document.querySelector('.video-grid');
    if (!grid) return;
    grid.className = grid.className.replace(/\bcount-\d+\b/g, '').trim();
    const count = grid.querySelectorAll('.video-wrapper').length;
    grid.classList.add('count-' + Math.max(1, Math.min(count, 5)));
}

// End of WebRTC logic

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Participant name display
   ═══════════════════════════════════════════════════════════════════════ */
socket.on('user-name', (socketId, name) => {
    const wrapper = peerVideos[socketId];
    if (wrapper) {
        const tag = wrapper.querySelector('.name-tag');
        if (tag) tag.textContent = name;
    }
});

function startCallSession() {
    // Update own name tag
    const selfWrapper = userVideo ? userVideo.closest('.video-wrapper') : null;
    if (selfWrapper) {
        const tag = selfWrapper.querySelector('.name-tag');
        if (tag) tag.textContent = (displayName || 'You') + ' (You)';
    }
    startMeetingTimer();
    startQualityMonitor();
    // Show host-only buttons
    if (isHost) {
        document.getElementById('end-meeting-button').style.display = '';
        document.getElementById('notes-toggle-button').style.display = '';
        document.getElementById('raise-hand-button').style.display = 'none';
        const recBtn = document.getElementById('record-button');
        if (recBtn) recBtn.style.display = '';
        loadNotesFromServer();
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Meeting timer
   ═══════════════════════════════════════════════════════════════════════ */
function startMeetingTimer() {
    const storageKey = 'vc_timer_' + roomName;
    const stored = localStorage.getItem(storageKey);
    callStartTime = stored ? parseInt(stored, 10) : Date.now();
    if (!stored) localStorage.setItem(storageKey, callStartTime);
    const el = document.getElementById('meeting-timer');
    if (el) el.style.display = 'inline-flex';
    timerInterval = setInterval(() => {
        const secs = Math.floor((Date.now() - callStartTime) / 1000);
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        if (el) el.textContent = m + ':' + s;
    }, 1000);
}

function stopMeetingTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    localStorage.removeItem('vc_timer_' + roomName);
    const el = document.getElementById('meeting-timer');
    if (el) el.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Connection quality indicator
   ═══════════════════════════════════════════════════════════════════════ */
function startQualityMonitor() {
    const el = document.getElementById('quality-indicator');
    if (el) el.style.display = 'inline-flex';
    qualityInterval = setInterval(async () => {
        const pcList = Object.values(peers);
        if (!pcList.length) return;
        try {
            const stats = await pcList[0].getStats();
            let lost = 0, received = 0;
            stats.forEach(r => {
                if (r.type === 'inbound-rtp' && r.kind === 'video') {
                    lost     += r.packetsLost     || 0;
                    received += r.packetsReceived || 0;
                }
            });
            const total   = lost + received;
            const loss    = total > 0 ? lost / total : 0;
            const icon    = el.querySelector('i');
            if (loss < 0.02) {
                el.style.color = '#22c55e'; el.title = 'Good connection';
                icon.className = 'fas fa-signal';
            } else if (loss < 0.06) {
                el.style.color = '#f59e0b'; el.title = 'Fair connection';
                icon.className = 'fas fa-signal';
            } else {
                el.style.color = '#ef4444'; el.title = 'Poor connection';
                icon.className = 'fas fa-wifi';
            }
        } catch(e) {}
    }, 5000);
}

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Fullscreen
   ═══════════════════════════════════════════════════════════════════════ */
const fullscreenButton = document.getElementById('fullscreen-button');
fullscreenButton.addEventListener('click', () => {
    const icon = fullscreenButton.querySelector('i');
    if (!document.fullscreenElement) {
        videoChatContainer.requestFullscreen().then(() => {
            icon.className = 'fas fa-compress';
            fullscreenButton.title = 'Exit Fullscreen';
        }).catch(() => {});
    } else {
        document.exitFullscreen().then(() => {
            icon.className = 'fas fa-expand';
            fullscreenButton.title = 'Toggle Fullscreen';
        }).catch(() => {});
    }
});
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
        const icon = document.getElementById('fullscreen-button').querySelector('i');
        if (icon) icon.className = 'fas fa-expand';
    }
});

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Raise hand
   ═══════════════════════════════════════════════════════════════════════ */
const raiseHandButton = document.getElementById('raise-hand-button');
raiseHandButton.addEventListener('click', () => {
    handRaised = !handRaised;
    raiseHandButton.classList.toggle('active', handRaised);
    if (handRaised) {
        raiseHandButton.title = 'Lower Hand';
        socket.emit('raise-hand', roomName);
        showToast('You raised your hand ✋');
    } else {
        raiseHandButton.title = 'Raise Hand';
        socket.emit('lower-hand', roomName);
        showToast('You lowered your hand');
    }
});

socket.on('hand-raised', (socketId, participantName) => {
    const notifId = `hand-${socketId}`;
    if (document.getElementById(notifId)) return;
    const el = document.createElement('div');
    el.className = 'notification-card';
    el.id = notifId;
    el.innerHTML = `
        <div><strong>✋ ${participantName || 'Patient'} raised their hand</strong></div>
        <div class="notification-actions">
            <button class="btn-admit" onclick="lowerParticipantHand('${socketId}')">Lower Hand</button>
        </div>
    `;
    hostNotifications.appendChild(el);
});

socket.on('hand-lowered', (socketId) => {
    const el = document.getElementById(`hand-${socketId}`);
    if (el) el.remove();
});

socket.on('hand-lowered-confirm', () => {
    handRaised = false;
    raiseHandButton.classList.remove('active');
    raiseHandButton.title = 'Raise Hand';
});

window.lowerParticipantHand = function(socketId) {
    socket.emit('lower-hand-for', socketId);
    const el = document.getElementById(`hand-${socketId}`);
    if (el) el.remove();
};

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: End meeting for all (host only)
   ═══════════════════════════════════════════════════════════════════════ */
document.getElementById('end-meeting-button').addEventListener('click', () => {
    if (!confirm('End the meeting for all participants? This cannot be undone.')) return;
    socket.emit('end-meeting', roomName);
    stopMeetingTimer();
    if (qualityInterval) { clearInterval(qualityInterval); qualityInterval = null; }
    location.href = '/';
});

socket.on('meeting-ended', () => {
    stopMeetingTimer();
    if (qualityInterval) { clearInterval(qualityInterval); qualityInterval = null; }
    Object.values(peers).forEach(pc => pc.close());
    videoChatContainer.style.display = 'none';
    document.getElementById('meeting-ended-overlay').style.display = 'flex';
});

/* ══════════════════════════════════════════════════════════════════════
   FEATURE: SOAP Notes (host-only, auto-saved per room)
   ══════════════════════════════════════════════════════════════════════ */
const notesToggleBtn = document.getElementById('notes-toggle-button');
const notesPanel     = document.getElementById('notes-panel');
const notesCloseBtn  = document.getElementById('notes-close-btn');

let notesOpen      = false;
let notesSaveTimer = null;
let notesLoaded    = false;

notesToggleBtn.addEventListener('click', () => {
    notesOpen = !notesOpen;
    notesPanel.classList.toggle('visible', notesOpen);
    notesToggleBtn.classList.toggle('active', notesOpen);
});

notesCloseBtn.addEventListener('click', () => {
    notesOpen = false;
    notesPanel.classList.remove('visible');
    notesToggleBtn.classList.remove('active');
});

function scheduleNotesSave() {
    const status = document.getElementById('notes-save-status');
    if (status) status.textContent = 'Saving…';
    if (notesSaveTimer) clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(saveNotes, 1500);
}

async function saveNotes() {
    if (!roomName) return;
    const notes = {
        s: document.getElementById('soap-s').value,
        o: document.getElementById('soap-o').value,
        a: document.getElementById('soap-a').value,
        p: document.getElementById('soap-p').value,
    };
    const status = document.getElementById('notes-save-status');
    try {
        const res = await fetch(`/api/meetings/${encodeURIComponent(roomName)}/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: JSON.stringify(notes) }),
            credentials: 'include',
        });
        if (res.ok) {
            if (status) { status.textContent = 'Saved ✓'; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
        } else {
            if (status) status.textContent = 'Save failed';
        }
    } catch(e) {
        if (status) status.textContent = 'Offline';
    }
}

async function loadNotesFromServer() {
    if (!roomName) return;
    try {
        const res = await fetch(`/api/meetings/${encodeURIComponent(roomName)}/notes`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.notes) {
            let n;
            try { n = JSON.parse(data.notes); } catch(e) { n = { s: data.notes, o: '', a: '', p: '' }; }
            document.getElementById('soap-s').value = n.s || '';
            document.getElementById('soap-o').value = n.o || '';
            document.getElementById('soap-a').value = n.a || '';
            document.getElementById('soap-p').value = n.p || '';
        }
        notesLoaded = true;
    } catch(e) { /* silent */ }
}

['soap-s', 'soap-o', 'soap-a', 'soap-p'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleNotesSave);
});

/* ═══════════════════════════════════════════════════════════════════════
   FEATURE: Session Recording (host-only, saved locally as .webm)
   ═══════════════════════════════════════════════════════════════════════ */
const recordButton = document.getElementById('record-button');
let mediaRecorder    = null;
let recChunks        = [];
let recStartTime     = null;
let recTimerInterval = null;
let recAudioCtx      = null;
let recAnimFrame     = null;

// Wire up consent checkbox enabling start button
const recConsentCheck = document.getElementById('rec-consent-check');
if (recConsentCheck) {
    recConsentCheck.addEventListener('change', function() {
        const startBtn = document.getElementById('rec-consent-start-btn');
        if (startBtn) {
            startBtn.disabled = !this.checked;
            startBtn.style.opacity = this.checked ? '1' : '.45';
        }
    });
}

// Record button click — show consent modal if not recording, stop if recording
if (recordButton) {
    recordButton.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        } else {
            const check = document.getElementById('rec-consent-check');
            const startBtn = document.getElementById('rec-consent-start-btn');
            if (check) check.checked = false;
            if (startBtn) { startBtn.disabled = true; startBtn.style.opacity = '.45'; }
            document.getElementById('rec-consent-modal').style.display = 'flex';
        }
    });
}

// Start recording from consent modal
const recConsentStartBtn = document.getElementById('rec-consent-start-btn');
if (recConsentStartBtn) {
    recConsentStartBtn.addEventListener('click', () => {
        document.getElementById('rec-consent-modal').style.display = 'none';
        startRecording();
    });
}

async function startRecording() {
    try {
        // ── Canvas composite for video ──────────────────────────────────────
        const recCanvas = document.createElement('canvas');
        recCanvas.width  = 1280;
        recCanvas.height = 720;
        const rCtx = recCanvas.getContext('2d');

        function drawRecFrame() {
            recAnimFrame = requestAnimationFrame(drawRecFrame);
            rCtx.fillStyle = '#0f0f1a';
            rCtx.fillRect(0, 0, 1280, 720);
            const videos = Array.from(document.querySelectorAll('#video-grid video'));
            if (!videos.length) return;
            const cols = Math.ceil(Math.sqrt(videos.length));
            const rows = Math.ceil(videos.length / cols);
            const tileW = 1280 / cols;
            const tileH = 720  / rows;
            videos.forEach((v, i) => {
                const col = i % cols, row = Math.floor(i / cols);
                try { rCtx.drawImage(v, col * tileW, row * tileH, tileW, tileH); } catch(e) {}
            });
        }
        drawRecFrame();

        // ── Web Audio mixer ─────────────────────────────────────────────────
        recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest  = recAudioCtx.createMediaStreamDestination();

        // Add local mic
        if (typeof localStream !== 'undefined' && localStream) {
            const localSrc = recAudioCtx.createMediaStreamSource(localStream);
            localSrc.connect(dest);
        }
        // Add all remote peer audio
        if (typeof peers !== 'undefined') {
            Object.values(peers).forEach(pc => {
                pc.getReceivers().forEach(r => {
                    if (r.track && r.track.kind === 'audio') {
                        try {
                            const peerStream = new MediaStream([r.track]);
                            const src = recAudioCtx.createMediaStreamSource(peerStream);
                            src.connect(dest);
                        } catch(e) {}
                    }
                });
            });
        }

        // ── Composite stream ────────────────────────────────────────────────
        const videoTrack = recCanvas.captureStream(30).getVideoTracks()[0];
        const audioTrack = dest.stream.getAudioTracks()[0];
        const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
        const recStream = new MediaStream(tracks);

        // ── MediaRecorder ───────────────────────────────────────────────────
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
            .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';

        mediaRecorder = new MediaRecorder(recStream, { mimeType, videoBitsPerSecond: 2_500_000 });
        recChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
        mediaRecorder.onstop = () => downloadRecording(mimeType);
        mediaRecorder.start(1000); // collect chunks every 1s

        // ── UI ──────────────────────────────────────────────────────────────
        recStartTime = Date.now();
        const indicator = document.getElementById('recording-indicator');
        if (indicator) indicator.style.display = 'flex';
        if (recordButton) {
            recordButton.classList.add('active');
            const icon = recordButton.querySelector('i');
            if (icon) { icon.classList.remove('fa-circle'); icon.classList.add('fa-stop'); icon.style.color = ''; }
            recordButton.title = 'Stop Recording';
        }

        recTimerInterval = setInterval(() => {
            const s = Math.floor((Date.now() - recStartTime) / 1000);
            const el = document.getElementById('rec-timer');
            if (el) el.textContent = String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
        }, 1000);

        showToast('Recording started');
    } catch(err) {
        console.error('Recording error:', err);
        showToast('Could not start recording: ' + (err.message || err));
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (recAnimFrame) { cancelAnimationFrame(recAnimFrame); recAnimFrame = null; }
    if (recAudioCtx)  { recAudioCtx.close().catch(()=>{}); recAudioCtx = null; }
    if (recTimerInterval) { clearInterval(recTimerInterval); recTimerInterval = null; }
    const indicator = document.getElementById('recording-indicator');
    if (indicator) indicator.style.display = 'none';
    if (recordButton) {
        recordButton.classList.remove('active');
        const icon = recordButton.querySelector('i');
        if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-circle'); icon.style.color = '#ef4444'; }
        recordButton.title = 'Record Session (Host Only)';
    }
    showToast('Recording stopped — preparing download…');
}

function downloadRecording(mimeType) {
    const ext  = mimeType.includes('webm') ? 'webm' : 'mp4';
    const blob = new Blob(recChunks, { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `session-${typeof roomName !== 'undefined' && roomName ? roomName.substring(0,8) : 'recording'}-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    recChunks = [];
}

