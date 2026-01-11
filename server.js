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
// sessions = { [userId]: { name, token, approved, isAdmin, connected: boolean, socketId: null } }
let sessions = {};
let removedUsers = []; // List of userIds marked as removed
let messages = [];
let requests = []; // { name, socketId, userId } (stores pending sockets)
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
            sessions = data.sessions || {};
            removedUsers = data.removedUsers || [];

            // On server restart, all sessions are initially disconnected
            Object.values(sessions).forEach(s => {
                s.connected = false;
                s.socketId = null;
            });
        } catch (e) { console.error(e); }
    }
}
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ messages, sessions, removedUsers }, null, 2));
}
function clearData() {
    messages = [];
    sessions = {};
    removedUsers = [];
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


    // 4. Join Request
    socket.on('join_request', (data) => {
        // data: { name, password (optional), token (optional), userId }
        let { name, password, userId } = data;
        if (!userId) {
            // Safety fallback if client didn't send it, but Step 1/2 says it should.
            return socket.emit('error_message', 'Identity missing. Please refresh.');
        }

        const normalizedName = name ? name.trim() : null;
        const lowerName = normalizedName ? normalizedName.toLowerCase() : null;

        // 4.2 Check Removal Status (MUST COME FIRST)
        if (removedUsers.includes(userId)) {
            socket.emit('user_removed', 'You were removed from the previous session');
            return;
        }

        // 4.3 Restore Returning User
        if (sessions[userId]) {
            const session = sessions[userId];

            // Re-bind socket
            session.socketId = socket.id;
            session.connected = true;

            // Logging (Verification Step 6)
            console.log(`User restored/reconnected: ${session.name} (${userId})`);

            if (session.isAdmin) adminActive = true;

            socket.emit('login_success', {
                name: session.name,
                isAdmin: session.isAdmin,
                token: session.token, // Keep token for backward compatibility with some client events if needed, but userId is primary
                userId: userId
            });
            socket.emit('load_messages', messages);

            if (!session.approved) {
                socket.emit('waiting_approval_with_token', session.token);
            }

            // Sync Admin UI if needed
            if (session.isAdmin) {
                const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
                socket.emit('update_requests', pending);

                const members = Object.values(sessions).filter(s => s.approved).map(s => ({ name: s.name, isAdmin: s.isAdmin, userId: s.userId }));
                socket.emit('update_members', members);
            }

            io.emit('user_list', getActiveUserNames());
            return;
        }

        // 4.4 Username Reservation (ONLY NOW)
        if (!normalizedName) return socket.emit('error_message', 'Name required');

        // Check if name is taken by a DIFFERENT userId
        const nameTakenByOther = Object.values(sessions).find(s => s.name.toLowerCase() === lowerName && s.userId !== userId);
        if (nameTakenByOther) {
            socket.emit('error_message', 'Name reserved');
            return;
        }

        // Potential Admin Join
        if (lowerName === 'admin') {
            if (password === 'Wh@tme') {
                // Password Correct
                sessions[userId] = {
                    userId: userId,
                    name: "Admin",
                    token: uuidv4(),
                    approved: true,
                    isAdmin: true,
                    connected: true,
                    socketId: socket.id
                };
                adminActive = true;
                saveData();

                console.log(`Admin joined: Admin (${userId})`);

                socket.emit('login_success', { name: "Admin", isAdmin: true, token: sessions[userId].token, userId: userId });
                socket.emit('load_messages', messages);

                // Send pending requests to Admin
                const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
                socket.emit('update_requests', pending);

                io.emit('user_list', getActiveUserNames());
            } else {
                if (password) {
                    socket.emit('error_message', 'Invalid Admin Password');
                }
                socket.emit('require_password');
            }
            return;
        }

        // New Session for Normal User
        const newToken = uuidv4();
        sessions[userId] = {
            userId: userId,
            name: normalizedName,
            token: newToken,
            approved: false,
            isAdmin: false,
            connected: true,
            socketId: socket.id
        };
        saveData();

        // Notify Admin
        const adminSession = Object.values(sessions).find(s => s.isAdmin && s.connected);
        if (adminSession) {
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
            io.to(adminSession.socketId).emit('update_requests', pending);
        }

        socket.emit('waiting_approval_with_token', newToken);
    });

    socket.on('admin_action', (data) => {
        const adminSession = Object.values(sessions).find(s => s.socketId === socket.id && s.isAdmin);
        if (adminSession) {
            const targetUserId = data.userId;
            const targetSession = sessions[targetUserId];

            if (!targetSession) return;

            if (data.action === 'approve') {
                targetSession.approved = true;
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('login_success', {
                        name: targetSession.name,
                        isAdmin: false,
                        userId: targetUserId
                    });
                    io.to(targetSession.socketId).emit('load_messages', messages);
                }
                saveData();
            } else if (data.action === 'reject') {
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('access_denied');
                }
                delete sessions[targetUserId];
                saveData();
            } else if (data.action === 'remove') {
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('user_removed', 'You were removed from the chat');
                }
                delete sessions[targetUserId];
                removedUsers.push(targetUserId);
                saveData();
            }

            // Sync Admin UI
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, userId: s.userId }));
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
            senderUserId: senderSession.userId, // Step 5
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
            // Check based on userId (Step 5/6)
            if (messages[msgIndex].senderUserId === senderSession.userId) {
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
            if (session.isAdmin) adminActive = false;
            delete sessions[session.userId];
            saveData();
            io.emit('user_list', getActiveUserNames());
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
