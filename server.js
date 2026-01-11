const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8
});

app.use(cors());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));

const DATA_FILE = 'chat_data.json';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// user = { id: socket.id, name, approved, isAdmin, token: uuid }
// We also need to map tokens to users to handle reconnection.
// But socket.id changes on reconnect. So user data should ideally be keyed by 'token' or 'name'.
// Let's use 'name' as unique key for simplicity in this strict environment, or separate 'sessions'.
// Structure: sessions = { [name]: { token, approved, isAdmin, connected: boolean, socketId: null } }
let sessions = {};
let messages = [];
let requests = []; // { name, socketId } (stores pending socketIds)
// adminName is fixed to 'Admin' by requirement if password matches, or just track who is admin.
// REQUIREMENT: "Admin" (case insensitive) -> requires password.
// REQUIREMENT: First user is admin? The prompt implies "if in the name i type Admin... it must ask me password".
// This implies the specific name "Admin" is special. 
// What about the "Start app -> First user is admin" rule? 
// The prompt says "I have decided another big thing... if name is Admin... ask password".
// This likely overrides the "First user = Admin" for *that specific name*, or maybe *only* 'Admin' can be admin now?
// "if in the name i type Admin case insensitive it must ask me passwaord"
// AND "there must be users... distinct name... if new user types that name it must say that the name is tekn"
// It seems the "First user is admin" might still apply for *permissions* if they join as something else? 
// Or maybe "Admin" is the ONLY way to be admin? The prompt is adding constraints.
// Let's stick to: "Admin" name = Super Admin (requires password).
// But for broader compatibility with previous "First user" rule:
// - If user joins as "Admin" (any case) -> Check Password. If Correct -> Become Admin.
// - If user joins as "Alice" -> If first user, maybe make Admin? OR just make "Admin" the only admin.
// Given "First user is admin" was my previous assumption, I should stick to it unless contradicted.
// But "Admin user" implies a specific role. I will implement: 
// 1. "Admin" name = Requires Password -> Grants Admin rights.
// 2. Normal name -> If first user ever? Let's just grant Admin to "Admin" name to be safe and explicit. 
// AND maybe if usage is LAN, someone *needs* to be admin. 
// I'll stick to: Only "Admin" (with password) is the true Admin. 
// Wait, then who approves "Admin"? "Admin" approves themselves? No, they have a password.
// "Admin" approves others. 

let adminActive = false; // Is an admin currently connected?

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE));
            messages = data.messages || [];
            const loadedSessions = data.sessions || {};

            // Migration & Initialization: Ensure sessions are keyed by token (userId)
            sessions = {};
            Object.values(loadedSessions).forEach(s => {
                const id = s.token || s.userId; // Migrate from old or use existing
                if (id) {
                    s.userId = id;
                    s.connected = false;
                    s.socketId = null;
                    sessions[id] = s;
                } else if (s.name) {
                    // Fallback for very old format if necessary
                    const fallbackId = uuidv4();
                    s.userId = fallbackId;
                    s.token = fallbackId;
                    s.connected = false;
                    s.socketId = null;
                    sessions[fallbackId] = s;
                }
            });
        } catch (e) { console.error(e); }
    }
}
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ messages, sessions }, null, 2));
}
function clearData() {
    messages = [];
    sessions = {};
    if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
}
loadData();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype, name: req.file.originalname });
    else res.status(400).send('Upload failed');
});

io.on('connection', (socket) => {
    // We only log once the user successfully identifies themselves via 'join_request'


    // 1. Join Request
    socket.on('join_request', (data) => {
        // data: { name, password (optional), token (optional), userId (optional) }
        let { name, password, token, userId } = data;
        const normalizedName = name ? name.trim() : "";
        const lowerName = normalizedName.toLowerCase();

        // RECONNECTION ATTEMPT (Lookup by stable userId)
        const effectiveId = userId || token;
        if (effectiveId && sessions[effectiveId]) {
            const session = sessions[effectiveId];

            if (session.removed) {
                socket.emit('error_message', 'You were removed from the previous session.');
                socket.emit('clear_token');
                return;
            }

            // Update socket ID
            const alreadyConnected = session.connected;
            session.socketId = socket.id;
            session.connected = true;

            // Update name if provided (Identity-Aware poaching check)
            if (normalizedName && !session.isAdmin && normalizedName !== session.name) {
                const lowerNewName = normalizedName.toLowerCase();
                const isPoached = Object.values(sessions).some(s => s.name.toLowerCase() === lowerNewName && s.userId !== session.userId);
                const isAdminPoached = lowerNewName === 'admin';

                if (isPoached || isAdminPoached) {
                    // Silently ignore poached name update on reconnection to allow entry with old name
                    console.log(`Identity ${session.userId} attempted to poach name "${normalizedName}" - request ignored.`);
                } else {
                    session.name = normalizedName;
                }
            }

            // Logging: Only log reconnects if they were actually offline
            if (!alreadyConnected && (session.approved || session.isAdmin)) {
                console.log(`User reconnected: ${session.name} (${socket.id})`);
            }

            // If it was the admin
            if (session.isAdmin) adminActive = true;

            socket.emit('login_success', {
                name: session.name,
                isAdmin: session.isAdmin,
                token: token,
                userId: session.userId
            });
            socket.emit('load_messages', messages);

            if (!session.approved) {
                socket.emit('waiting_approval_with_token', token);
            }

            // If admin reconnects, they need requests update
            if (session.isAdmin) {
                const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin && !s.removed).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
                socket.emit('update_requests', pending);

                const members = Object.values(sessions).filter(s => s.approved).map(s => ({ name: s.name, isAdmin: s.isAdmin, userId: s.userId }));
                socket.emit('update_members', members);
            }

            io.emit('user_list', getActiveUserNames()); // Update list for mentions
            return;
        }

        // NEW LOGIN

        // Check if name is taken (and currently connected or reserved)
        // If "Admin" is taken but disconnected, we might allow reclaim if password matches (handled above if token mechanism used).
        // If user tries to login as "Admin" without token (new device), prompt password.



        if (lowerName === 'admin') {
            if (password === 'Wh@tme') {
                // Password Correct
                // If Admin already active? 
                // "There must be only one person with a name".
                // If Admin session exists and is connected:
                // Create/Update Admin Session
                const adminSession = Object.values(sessions).find(s => s.isAdmin);
                const idToUse = adminSession ? adminSession.userId : uuidv4();

                sessions[idToUse] = {
                    userId: idToUse,
                    name: "Admin", // Force proper casing
                    token: idToUse,
                    approved: true, // Admin is always approved
                    isAdmin: true,
                    connected: true,
                    socketId: socket.id
                };
                adminActive = true;
                saveData(); // Persist new admin session

                console.log(`Admin joined: Admin (${socket.id})`);

                socket.emit('login_success', { name: "Admin", isAdmin: true, token: idToUse, userId: idToUse });
                socket.emit('load_messages', messages);

                // Send pending requests to Admin
                const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin && !s.removed).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
                socket.emit('update_requests', pending);

                io.emit('user_list', getActiveUserNames());
            } else {
                if (password) {
                    socket.emit('error_message', 'Invalid Admin Password');
                }
                socket.emit('require_password'); // Tell client to ask for password
            }
            return;
        }

        // Normal User
        // Check duplicate name (Identity-Aware Reservation)
        const poachedSession = Object.values(sessions).find(s => s.name.toLowerCase() === lowerName);
        if (poachedSession && poachedSession.userId !== effectiveId) {
            if (poachedSession.connected) {
                socket.emit('error_message', 'Name is already taken. Please choose another.');
            } else {
                socket.emit('error_message', 'Name is unavailable (reserved).');
            }
            return;
        }

        // New Session
        const id = uuidv4();
        sessions[id] = {
            userId: id,
            name: normalizedName,
            token: id,
            approved: false,
            isAdmin: false,
            connected: true,
            socketId: socket.id
        };
        saveData(); // Persist new session request

        // Notify Admin
        const adminSession = Object.values(sessions).find(s => s.isAdmin && s.connected);
        if (adminSession) {
            // Better: send full list
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin && !s.removed).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
            io.to(adminSession.socketId).emit('update_requests', pending);

            // Also send members just in case but usually only requests change here
            const members = Object.values(sessions).filter(s => s.approved).map(s => ({ name: s.name, isAdmin: s.isAdmin, userId: s.userId }));
            io.to(adminSession.socketId).emit('update_members', members);
        }

        socket.emit('waiting_approval_with_token', id); // Client saves token
    });

    socket.on('admin_action', (data) => {
        // Check if sender is admin
        const adminSession = Object.values(sessions).find(s => s.socketId === socket.id && s.isAdmin);
        if (!adminSession) return;

        const targetId = data.userId || data.name; // userId is primary, name is fallback for transition
        const targetSession = sessions[targetId] || Object.values(sessions).find(s => s.name === targetId);

        if (targetSession) {
            if (data.action === 'approve') {
                targetSession.approved = true;
                console.log(`User joined: ${targetSession.name} (Approved by Admin)`);
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('login_success', {
                        name: targetSession.name,
                        isAdmin: false,
                        token: targetSession.token,
                        userId: targetSession.userId
                    });
                    io.to(targetSession.socketId).emit('load_messages', messages);
                }
                saveData(); // Persist approval state
            } else if (data.action === 'reject') {
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('access_denied');
                    io.to(targetSession.socketId).emit('clear_token'); // Tell client to forget token
                }
                delete sessions[targetSession.userId];
            } else if (data.action === 'remove') { // NEW: Remove Member (Persistent)
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('user_removed');
                    io.to(targetSession.socketId).emit('clear_token');
                }
                targetSession.approved = false;
                targetSession.connected = false;
                targetSession.removed = true; // Mark as persistently removed
                targetSession.socketId = null;
                saveData(); // Persist removal state
            }

            // Update Admin UI
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin && !s.removed).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));

            // Send updated lists to Admin
            socket.emit('update_requests', pending);

            const members = Object.values(sessions).filter(s => s.approved).map(s => ({ name: s.name, isAdmin: s.isAdmin, userId: s.userId }));
            socket.emit('update_members', members);

            io.emit('user_list', getActiveUserNames());
        }
    });

    socket.on('send_message', (msgData) => {
        const senderSession = Object.values(sessions).find(s => s.socketId === socket.id);
        if (!senderSession || !senderSession.approved) return;

        const message = {
            id: Date.now().toString(),
            sender: senderSession.name,
            senderUserId: senderSession.userId, // Use stable userId for alignment
            senderId: senderSession.token, // Keep for legacy/deletion logic compatibility
            text: msgData.text || '',
            file: msgData.file || null,
            replyTo: msgData.replyTo || null,
            timestamp: new Date().toISOString(),
            deleted: false
        };
        messages.push(message);
        io.emit('new_message', message);
    });

    socket.on('delete_message', (msgId) => {
        const senderSession = Object.values(sessions).find(s => s.socketId === socket.id);
        if (!senderSession) return;

        const msgIndex = messages.findIndex(m => m.id === msgId);
        if (msgIndex !== -1) {
            // Check based on token (persistent ID)
            if (messages[msgIndex].senderId === senderSession.token) {
                messages[msgIndex].deleted = true;
                messages[msgIndex].text = "";
                messages[msgIndex].file = null;
                io.emit('message_deleted', msgId);
            }
        }
    });

    socket.on('end_session', (choice) => {
        const adminSession = Object.values(sessions).find(s => s.socketId === socket.id && s.isAdmin);
        if (!adminSession) return;

        if (choice === 'save') saveData();
        else clearData();

        io.emit('session_ended');
        sessions = {};
        requests = [];
        adminActive = false;

        // Gracefully stop the server process
        console.log(`\n🛑 Admin triggered server shutdown. Choice: ${choice}`);
        setTimeout(() => {
            console.log("👋 Server stopping...");
            process.exit(0);
        }, 1000); // 1 second delay to ensure clients receive the signal
    });

    socket.on('logout_self', () => {
        const session = Object.values(sessions).find(s => s.socketId === socket.id);
        if (session) {
            // Remove from sessions so name can be reused and no auto-reconnect
            if (session.isAdmin) adminActive = false;
            delete sessions[session.userId];
            saveData(); // Persist logout


            // Notify Admin if a pending user left? 
            // Or if active user left, update user list
            io.emit('user_list', getActiveUserNames());

            // If admin left, maybe just notify? 
            // Requirements: "Option for admin... 1. logout self".
            // Implementation: Just delete session.
        }
    });

    socket.on('disconnect', () => {
        const session = Object.values(sessions).find(s => s.socketId === socket.id);
        if (session) {
            // Only mark as disconnected IF we are still the primary socket for this session
            if (session.socketId === socket.id) {
                session.connected = false;
                if (session.isAdmin) adminActive = false;
                // Only log disconnects for users who were actually approved or admins
                if (session.approved || session.isAdmin) {
                    console.log(`User disconnected: ${session.name}`);
                }
            }
        }
    });

    // Feature: User List for Mentions
    socket.on('get_users', () => {
        socket.emit('user_list', getActiveUserNames());
    });
});

function getActiveUserNames() {
    return Object.values(sessions)
        .filter(s => s.approved && s.connected)
        .map(s => s.name);
}

const PORT = 8000;
server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';

    for (let devName in interfaces) {
        let iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            let alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                localIp = alias.address;
            }
        }
    }

    console.log(`\n🚀 Server is RUNNING!`);
    console.log(`-------------------------------------------`);
    console.log(`🏠 On this PC:   http://localhost:${PORT}`);
    console.log(`📱 On Mobile:    http://${localIp}:${PORT}`);
    console.log(`-------------------------------------------\n`);
});
