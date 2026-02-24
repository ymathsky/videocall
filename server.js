require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Gemini AI setup ───────────────────────────────────────────────────────────
let geminiModel = null;
if (process.env.GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    console.log('[AI] Gemini model loaded.');
  } catch(e) {
    console.warn('[AI] Failed to init Gemini:', e.message);
  }
} else {
  console.warn('[AI] GEMINI_API_KEY not set — AI summaries disabled.');
}
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware to parse JSON bodies
app.use(express.json());

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const adminSessions = new Map();

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const key = item.slice(0, separatorIndex);
      const value = decodeURIComponent(item.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

function getAdminToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.admin_session;
}

function isValidSession(token) {
  const expiresAt = adminSessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  const token = getAdminToken(req);
  if (!token || !isValidSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  next();
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions.entries()) {
    if (expiresAt < now) {
      adminSessions.delete(token);
    }
  }
}

setInterval(clearExpiredSessions, 1000 * 60 * 10).unref();

// Initialize SQLite Database
const DB_PATH = process.env.DB_PATH || './videocall.db';
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      password TEXT DEFAULT '',
      expires_at DATETIME,
      started_at DATETIME,
      ended_at DATETIME,
      duration_seconds INTEGER,
      summary TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS consents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      signature TEXT NOT NULL,
      signed_date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )`, () => {
      const defaults = [
        ['company_name', 'TeleHealth Connect'],
        ['tagline',       'Secure Video Consultations'],
        ['timezone',      'UTC'],
        ['contact_email', ''],
        ['contact_phone', ''],
        ['company_logo',  ''],
        ['smtp_host',     ''],
        ['smtp_port',     '587'],
        ['smtp_user',     ''],
        ['smtp_pass',     ''],
        ['smtp_from',     '']
      ];
      defaults.forEach(([k, v]) => {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]);
      });
    });

    // Security schema migrations (safe to run repeatedly — errors are silently ignored)
    db.run(`ALTER TABLE meetings ADD COLUMN password TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE meetings ADD COLUMN expires_at DATETIME`, () => {});
    // Duration tracking migrations
    db.run(`ALTER TABLE meetings ADD COLUMN started_at DATETIME`, () => {});
    db.run(`ALTER TABLE meetings ADD COLUMN ended_at DATETIME`, () => {});
    db.run(`ALTER TABLE meetings ADD COLUMN duration_seconds INTEGER`, () => {});
    // AI summary migration
    db.run(`ALTER TABLE meetings ADD COLUMN summary TEXT`, () => {});

    // Chat messages table
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS join_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Staff / provider profiles
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT DEFAULT '',
      email TEXT DEFAULT '',
      role TEXT DEFAULT 'Doctor',
      specialty TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Credential migrations for existing databases
    db.run(`ALTER TABLE users ADD COLUMN username TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT ''`, () => {});
    // SOAP notes + patient email migrations
    db.run(`ALTER TABLE meetings ADD COLUMN soap_notes TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE consents ADD COLUMN email TEXT DEFAULT ''`, () => {});
    db.run(`ALTER TABLE consents ADD COLUMN room_name TEXT DEFAULT ''`, () => {});
  }
});

// Serve static files from the current directory
app.use(express.static(__dirname, {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Route for admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

// Host join route — redirects to /?room=X&host=1
app.get('/host/:room', (req, res) => {
  const room = encodeURIComponent(req.params.room);
  res.redirect('/?room=' + room + '&host=1');
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);

  const maxAgeSeconds = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const securePart = isSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${securePart}`);
  res.json({ message: 'Login successful' });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ authenticated: true, username: ADMIN_USERNAME });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = getAdminToken(req);
  if (token) {
    adminSessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ message: 'Logout successful' });
});

// Route for consent form
app.get('/consent', (req, res) => {
  res.sendFile(__dirname + '/consent.html');
});

// Public provider profile page
app.get('/profile/:id', (req, res) => {
  res.sendFile(__dirname + '/profile.html');
});

// API Routes
app.post('/api/meetings', requireAdmin, (req, res) => {
  const { roomName, password } = req.body;
  if (!roomName)  return res.status(400).json({ error: 'Room name is required' });
  if (!password)  return res.status(400).json({ error: 'Password is required' });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.run(`INSERT INTO meetings (room_name, password, expires_at) VALUES (?, ?, ?)`,
    [roomName, password, expiresAt],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, roomName, password, expiresAt, message: 'Meeting saved successfully' });
    }
  );
});

app.get('/api/meetings', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM meetings ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// SOAP Notes — per room
app.get('/api/meetings/:roomName/notes', requireAdmin, (req, res) => {
  db.get(
    `SELECT soap_notes AS notes FROM meetings WHERE room_name = ?`,
    [req.params.roomName],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ notes: row ? (row.notes || '') : '' });
    }
  );
});

app.put('/api/meetings/:roomName/notes', requireAdmin, (req, res) => {
  const { notes } = req.body;
  // Try update first; if no row exists (unregistered room), insert one
  db.run(
    `UPDATE meetings SET soap_notes = ? WHERE room_name = ?`,
    [notes || '', req.params.roomName],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) {
        db.run(
          `INSERT OR IGNORE INTO meetings (room_name, soap_notes) VALUES (?, ?)`,
          [req.params.roomName, notes || '']
        );
      }
      res.json({ message: 'Notes saved' });
    }
  );
});

app.get('/api/meetings/:roomName/messages', requireAdmin, (req, res) => {
  db.all(
    `SELECT sender_name, message, sent_at FROM chat_messages WHERE room_name = ? ORDER BY sent_at ASC`,
    [req.params.roomName],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/consents', (req, res) => {
  const { firstName, lastName, signature, date, roomName, email } = req.body;
  if (!firstName || !lastName || !signature || !date) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  db.run(`INSERT INTO consents (first_name, last_name, signature, signed_date, email, room_name) VALUES (?, ?, ?, ?, ?, ?)`,
    [firstName, lastName, signature, date, email || '', roomName || ''],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const consentId = this.lastID;

      if (roomName) {
        // Generate a one-time join token tied to this room
        const token = crypto.randomBytes(32).toString('hex');
        db.run(`INSERT INTO join_tokens (room_name, token) VALUES (?, ?)`, [roomName, token], (err2) => {
          if (err2) {
            console.error('join_token insert error:', err2.message);
            return res.json({ id: consentId, message: 'Consent submitted' }); // still succeed
          }
          res.json({ id: consentId, message: 'Consent form submitted successfully', joinToken: token });
        });
      } else {
        res.json({ id: consentId, message: 'Consent form submitted successfully' });
      }
    }
  );
});

app.get('/api/consents', requireAdmin, (req, res) => {
  db.all(`SELECT * FROM consents ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Settings — public read, admin write
app.get('/api/settings', (req, res) => {
  db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });
    res.json(out);
  });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const allowed = ['company_name', 'tagline', 'timezone', 'contact_email', 'contact_phone', 'company_logo', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No valid settings provided' });
  const tasks = updates.map(([k, v]) =>
    new Promise((resolve, reject) => {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, v],
        err => err ? reject(err) : resolve());
    })
  );
  Promise.all(tasks)
    .then(() => res.json({ message: 'Settings saved' }))
    .catch(e => res.status(500).json({ error: e.message }));
});

// ── Users (staff / providers) CRUD ──────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

app.get('/api/users', requireAdmin, (req, res) => {
  db.all(
    `SELECT id, name, username, email, role, specialty, phone, bio, photo_url, created_at FROM users ORDER BY name ASC`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { name, username, email, role, specialty, phone, bio, photo_url, password } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!password) return res.status(400).json({ error: 'Password is required' });
  const { hash, salt } = hashPassword(password);
  db.run(
    `INSERT INTO users (name, username, email, role, specialty, phone, bio, photo_url, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, username.toLowerCase().trim(), email||'', role||'Doctor', specialty||'', phone||'', bio||'', photo_url||'', hash, salt],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: 'User created' });
    }
  );
});

// Public read — no auth required (for shareable profile pages)
app.get('/api/users/public/:id', (req, res) => {
  db.get(
    `SELECT id, name, username, email, role, specialty, phone, bio, photo_url, created_at FROM users WHERE id = ?`,
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'User not found' });
      res.json(row);
    }
  );
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { name, username, email, role, specialty, phone, bio, photo_url, password } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!username) return res.status(400).json({ error: 'Username is required' });

  if (password) {
    // Update profile + credentials
    const { hash, salt } = hashPassword(password);
    db.run(
      `UPDATE users SET name=?, username=?, email=?, role=?, specialty=?, phone=?, bio=?, photo_url=?, password_hash=?, password_salt=? WHERE id=?`,
      [name, username.toLowerCase().trim(), email||'', role||'Doctor', specialty||'', phone||'', bio||'', photo_url||'', hash, salt, req.params.id],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User updated' });
      }
    );
  } else {
    // Profile + username only (keep existing password)
    db.run(
      `UPDATE users SET name=?, username=?, email=?, role=?, specialty=?, phone=?, bio=?, photo_url=? WHERE id=?`,
      [name, username.toLowerCase().trim(), email||'', role||'Doctor', specialty||'', phone||'', bio||'', photo_url||'', req.params.id],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User updated' });
      }
    );
  }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  db.run(`DELETE FROM users WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'User deleted' });
  });
});

const activeRooms  = {}; // { roomName: { password, hostId, participants:Set, expiresAt, startedAt } }

// ── Meeting duration finalize + AI summary ────────────────────────────────────
async function finalizeMeeting(roomName) {
  const room = activeRooms[roomName];
  if (!room) return;
  const endedAt = new Date();
  const durationSec = room.startedAt ? Math.floor((Date.now() - room.startedAt) / 1000) : 0;
  const hrs  = Math.floor(durationSec / 3600);
  const mins = Math.floor((durationSec % 3600) / 60);
  const secs = durationSec % 60;
  const readable = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  console.log(`[MEETING LOG] Room "${roomName}" ended. Duration: ${readable} (${durationSec}s)`);

  // ── Attempt AI summary — pull from DB (authoritative) then fall back to in-memory ──
  const buildSummary = () => new Promise((resolve) => {
    db.all(
      `SELECT sender_name, message FROM chat_messages WHERE room_name = ? ORDER BY sent_at ASC`,
      [roomName],
      async (err, rows) => {
        const lines = (!err && rows.length) ? rows.map(r => `${r.sender_name}: ${r.message}`) : (room.chatLog || []);
        if (!geminiModel) { resolve(null); return; }
        if (lines.length === 0) { resolve('No chat messages were exchanged during this meeting.'); return; }
        try {
          const transcript = lines.join('\n');
          const prompt = `You are a medical assistant. The following is the chat transcript from a telehealth video consultation between a doctor and a patient. Write a concise, professional clinical summary (under 200 words) covering: who said what, main topics discussed, symptoms or concerns raised, any advice or next steps mentioned. Format it clearly with the patient and doctor\'s contributions distinguished.\n\nTranscript:\n${transcript}`;
          const result = await geminiModel.generateContent(prompt);
          console.log(`[AI] Summary generated for room "${roomName}"`);
          resolve(result.response.text());
        } catch(e) {
          console.error('[AI] Summary error:', e.message);
          resolve(null);
        }
      }
    );
  });
  const summary = await buildSummary();

  if (room.startedAt) {
    db.run(
      `UPDATE meetings SET ended_at = ?, duration_seconds = ?, summary = ? WHERE room_name = ?`,
      [endedAt.toISOString(), durationSec, summary, roomName]
    );
  }

  // Send follow-up email to patient if email was collected via consent form
  db.get(
    `SELECT email FROM consents WHERE room_name = ? AND email != '' ORDER BY created_at DESC LIMIT 1`,
    [roomName],
    (err, consent) => {
      if (!err && consent && consent.email) {
        sendFollowUpEmail(roomName, consent.email, summary, durationSec);
      }
    }
  );
}

// ── Follow-up email ───────────────────────────────────────────────────────────
function fmtDurationStr(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function sendFollowUpEmail(roomName, patientEmail, summary, durationSec) {
  try {
    const settings = await new Promise((resolve, reject) => {
      db.all(
        `SELECT key, value FROM settings WHERE key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','company_name')`,
        [],
        (err, rows) => {
          if (err) { reject(err); return; }
          const s = {};
          rows.forEach(r => { s[r.key] = r.value; });
          resolve(s);
        }
      );
    });

    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      console.log('[EMAIL] SMTP not configured — skipping follow-up email');
      return;
    }

    const port      = parseInt(settings.smtp_port) || 587;
    const transporter = nodemailer.createTransport({
      host: settings.smtp_host,
      port,
      secure: port === 465,
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    });

    const companyName = settings.company_name || 'TeleHealth Connect';
    const fromAddr    = settings.smtp_from   || `${companyName} <${settings.smtp_user}>`;
    const dur         = durationSec ? fmtDurationStr(durationSec) : 'N/A';
    const summaryHtml = summary
      ? summary.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
      : 'No summary available for this visit.';

    const htmlBody = `
<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:32px 0;margin:0;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
  <div style="background:linear-gradient(135deg,#0d9488,#0891b2);padding:28px 32px;">
    <h2 style="color:#fff;margin:0;font-size:1.3rem;">${companyName}</h2>
    <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px;">Thank you for your telehealth consultation</p>
  </div>
  <div style="padding:28px 32px;">
    <h3 style="color:#0f172a;margin-top:0;">Visit Summary</h3>
    <div style="background:#f1f5f9;border-left:4px solid #0d9488;padding:16px 20px;border-radius:0 8px 8px 0;color:#334155;line-height:1.7;font-size:14px;">${summaryHtml}</div>
    <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;">
      <tr style="border-top:1px solid #e2e8f0;"><td style="padding:10px 0;color:#64748b;">Duration</td><td style="text-align:right;color:#0f172a;font-weight:600;">${dur}</td></tr>
    </table>
  </div>
  <div style="background:#f8fafc;padding:18px 32px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="font-size:12px;color:#94a3b8;margin:0;">This is an automated message from ${companyName}. Please contact your provider if you have questions.</p>
  </div>
</div></body></html>`;

    await transporter.sendMail({
      from: fromAddr,
      to:   patientEmail,
      subject: `Your consultation summary — ${companyName}`,
      html:    htmlBody,
    });
    console.log(`[EMAIL] Follow-up sent to ${patientEmail} for room "${roomName}"`);
  } catch(e) {
    console.error('[EMAIL] Failed:', e.message);
  }
}
const pendingTokens = new Map(); // guestSocketId -> joinToken (cleared after admit/deny/disconnect)
const joinAttempts  = new Map(); // ip -> { count, resetAt } — rate limiting

function checkRateLimit(ip) {
  const now  = Date.now();
  let entry  = joinAttempts.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry = { count: 0, resetAt: now + 60_000 }; }
  entry.count++;
  joinAttempts.set(ip, entry);
  return entry.count <= 5; // allow up to 5 attempts per 60 seconds
}

// Purge expired rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  Object.entries(activeRooms).forEach(([room, meta]) => {
    if (meta.expiresAt && meta.expiresAt < now) {
      delete activeRooms[room];
      console.log(`Purged expired room: ${room}`);
    }
  });
}, 10 * 60 * 1000).unref();

io.on('connection', (socket) => {
  console.log('A user connected: ' + socket.id);

  socket.on('create-room', (roomName, name) => {
    socket.participantName = (typeof name === 'string' && name.trim()) ? name.trim() : 'Host';
    // Load meeting record from DB so password and expiry are authoritative
    db.get(`SELECT * FROM meetings WHERE room_name = ?`, [roomName], (err, meeting) => {
      if (!meeting) {
        // No DB record — still allow host to create (backward compat / manual rooms)
        activeRooms[roomName] = {
          password: null,
          hostId: socket.id,
          participants: new Set([socket.id]),
          expiresAt: null
        };
        socket.join(roomName);
        socket.emit('created', roomName);
        console.log(`Host ${socket.id} created unregistered room ${roomName}`);
        return;
      }

      // Check if this meeting has already expired
      if (meeting.expires_at && new Date(meeting.expires_at) < new Date()) {
        socket.emit('room-error', 'This meeting link has expired. Please generate a new one from the admin dashboard.');
        return;
      }

      activeRooms[roomName] = {
        password: meeting.password || null,
        hostId: socket.id,
        participants: new Set([socket.id]),
        expiresAt: meeting.expires_at ? new Date(meeting.expires_at).getTime() : null
      };
      socket.join(roomName);
      socket.emit('created', roomName);
      console.log(`Host ${socket.id} created room ${roomName}`);
    });
  });

  socket.on('join-request', (roomName, password, joinToken, name) => {
    socket.participantName = (typeof name === 'string' && name.trim()) ? name.trim() : 'Patient';
    const ip = socket.handshake.address;

    // ── Rate limiting ──────────────────────────────────────────────────────────
    if (!checkRateLimit(ip)) {
      socket.emit('join-error', 'Too many failed attempts. Please wait a minute and try again.');
      return;
    }

    // ── Room existence ─────────────────────────────────────────────────────────
    const room = activeRooms[roomName];
    if (!room) {
      socket.emit('join-error', 'Room does not exist.');
      return;
    }

    // ── Room expiry ────────────────────────────────────────────────────────────
    if (room.expiresAt && room.expiresAt < Date.now()) {
      socket.emit('join-error', 'This meeting has expired.');
      return;
    }

    // ── Capacity (max 5 participants) ───────────────────────────────────────────
    if (room.participants && room.participants.size >= 5) {
      socket.emit('join-error', 'This meeting room is full (maximum 5 participants).');
      return;
    }

    // ── Password check ─────────────────────────────────────────────────────────
    if (room.password && room.password !== password) {
      socket.emit('join-error', 'Incorrect password.');
      return;
    }

    // ── Join token validation ──────────────────────────────────────────────────
    if (joinToken) {
      db.get(
        `SELECT * FROM join_tokens WHERE token = ? AND room_name = ? AND used = 0`,
        [joinToken, roomName],
        (err, row) => {
          if (err || !row) {
            socket.emit('join-error', 'Your session token is invalid or has already been used. Please complete the consent form again.');
            return;
          }
          // Token valid — hold it until admitted
          pendingTokens.set(socket.id, joinToken);
          socket.emit('waiting-room');
          io.to(room.hostId).emit('guest-waiting', { socketId: socket.id, roomName, name: socket.participantName });
          console.log(`Patient ${socket.id} in waiting room for ${roomName}`);
        }
      );
    } else if (room.password) {
      // Room has a password (was created through admin) — require a consent token
      socket.emit('join-error', 'Access denied. Please use the secure patient link provided by your provider.');
    } else {
      // No password, no token required (manual / legacy room)
      socket.emit('waiting-room');
      io.to(room.hostId).emit('guest-waiting', { socketId: socket.id, roomName, name: socket.participantName });
    }
  });

  socket.on('admit-guest', (guestSocketId, roomName) => {
    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) {
      // Mark join token as used (one-time)
      const guestToken = pendingTokens.get(guestSocketId);
      if (guestToken) {
        db.run(`UPDATE join_tokens SET used = 1 WHERE token = ?`, [guestToken]);
        pendingTokens.delete(guestSocketId);
      }

      // Track participant & record call start time
      if (activeRooms[roomName]) {
        activeRooms[roomName].participants.add(guestSocketId);
        if (!activeRooms[roomName].startedAt) {
          activeRooms[roomName].startedAt = Date.now();
          db.run(`UPDATE meetings SET started_at = ? WHERE room_name = ?`,
            [new Date().toISOString(), roomName]);
          console.log(`[MEETING LOG] Room "${roomName}" call started.`);
        }
      }

      guestSocket.join(roomName);
      guestSocket.emit('admitted', roomName);
      console.log(`Patient ${guestSocketId} admitted to room ${roomName}`);
    }
  });

  socket.on('deny-guest', (guestSocketId) => {
    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) {
      pendingTokens.delete(guestSocketId);
      guestSocket.emit('denied');
    }
  });

  socket.on('ready', (roomName) => {
    socket.broadcast.to(roomName).emit('ready', socket.id); // Send user ID to others
  });

  socket.on('candidate', (candidate, roomName, targetId) => {
    console.log("candidate", socket.id, targetId);
    socket.to(targetId).emit('candidate', candidate, socket.id);
  });

  socket.on('offer', (offer, roomName, targetId) => {
    console.log("offer", socket.id, targetId);
    socket.to(targetId).emit('offer', offer, socket.id);
  });

  socket.on('answer', (answer, roomName, targetId) => {
    console.log("answer", socket.id, targetId);
    socket.to(targetId).emit('answer', answer, socket.id);
  });

  socket.on('chat-message', (message, roomName) => {
    const senderName = socket.participantName || 'Unknown';
    const timestamp  = new Date().toISOString();
    // Persist to database
    db.run(
      `INSERT INTO chat_messages (room_name, sender_name, message, sent_at) VALUES (?, ?, ?, ?)`,
      [roomName, senderName, message, timestamp]
    );
    // Broadcast enriched object to other participants
    socket.broadcast.to(roomName).emit('chat-message', { message, senderName, timestamp });
    // Keep in-memory log for AI summary fallback
    if (activeRooms[roomName]) {
      if (!activeRooms[roomName].chatLog) activeRooms[roomName].chatLog = [];
      activeRooms[roomName].chatLog.push(`${senderName}: ${message}`);
    }
  });

  // ── Name sharing ───────────────────
  socket.on('user-name', (roomName, name) => {
    socket.participantName = name;
    socket.broadcast.to(roomName).emit('user-name', socket.id, name);
  });

  // ── Raise / lower hand ──────────────────
  socket.on('raise-hand', (roomName) => {
    const room = activeRooms[roomName];
    if (room) io.to(room.hostId).emit('hand-raised', socket.id, socket.participantName || 'Patient');
  });

  socket.on('lower-hand', (roomName) => {
    socket.emit('hand-lowered-confirm');
    const room = activeRooms[roomName];
    if (room) io.to(room.hostId).emit('hand-lowered', socket.id);
  });

  socket.on('lower-hand-for', (guestSocketId) => {
    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) guestSocket.emit('hand-lowered-confirm');
  });

  // ── Name sharing ─────────────────────────────────────────────────────────
  socket.on('user-name', (roomName, name) => {
    socket.participantName = name;
    socket.broadcast.to(roomName).emit('user-name', socket.id, name);
  });

  // ── Raise / lower hand ───────────────────────────────────────────────────
  socket.on('raise-hand', (roomName) => {
    const room = activeRooms[roomName];
    if (room) io.to(room.hostId).emit('hand-raised', socket.id, socket.participantName || 'Patient');
  });

  socket.on('lower-hand', (roomName) => {
    socket.emit('hand-lowered-confirm');
    const room = activeRooms[roomName];
    if (room) io.to(room.hostId).emit('hand-lowered', socket.id);
  });

  socket.on('lower-hand-for', (guestSocketId) => {
    const guestSocket = io.sockets.sockets.get(guestSocketId);
    if (guestSocket) guestSocket.emit('hand-lowered-confirm');
  });

  // ── End meeting (host only) ───────────────────────────────────────────────
  socket.on('end-meeting', (roomName) => {
    const room = activeRooms[roomName];
    if (room && room.hostId === socket.id) {
      finalizeMeeting(roomName);
      socket.broadcast.to(roomName).emit('meeting-ended');
      delete activeRooms[roomName];
    }
  });

  socket.on('disconnecting', () => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.to(room).emit('user-disconnected', socket.id);
        if (activeRooms[room]) {
          // If host disconnects, finalize the meeting duration log
          if (activeRooms[room].hostId === socket.id) {
            finalizeMeeting(room);
            delete activeRooms[room];
          } else {
            activeRooms[room].participants.delete(socket.id);
          }
        }
      }
    });
    pendingTokens.delete(socket.id);
  });

  socket.on('disconnect', () => {
      console.log('User disconnected: ' + socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
