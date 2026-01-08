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
let pendingAdminConflict = null;

function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DATA_FILE));
            messages = data.messages || [];
        } catch (e) { console.error(e); }
    }
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify({ messages }, null, 2)); }
function clearData() {
    messages = [];
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
    console.log('User connected:', socket.id);

    // 1. Join Request
    socket.on('join_request', (data) => {
        // data: { name, password, message, token, force }
        let { name, password, message, token, force } = data;
        const normalizedName = name.trim();
        const lowerName = normalizedName.toLowerCase();

        // RECONNECTION ATTEMPT
        if (token) {
            // Find session with this token
            const existingSessionUser = Object.keys(sessions).find(u => sessions[u].token === token);
            if (existingSessionUser) {
                // Determine if valid reconnection
                const session = sessions[existingSessionUser];
                session.socketId = socket.id;
                session.connected = true;
                if (session.isAdmin) adminActive = true;
                socket.emit('login_success', { name: session.name, isAdmin: session.isAdmin, token: token });
                socket.emit('load_messages', messages);
                if (!session.approved) socket.emit('waiting_approval_with_token', token);
                if (session.isAdmin) {
                    const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, message: s.message }));
                    socket.emit('update_requests', pending);
                }
                io.emit('user_list', getActiveUserNames());
                return;
            }
        }

        if (lowerName === 'admin') {
            if (password === 'Wh@tme') {
                // Password Correct
                if (sessions[normalizedName] && sessions[normalizedName].connected) {

                    if (force === true) {
                        // Force Logout of existing admin
                        const oldSocketId = sessions[normalizedName].socketId;
                        io.to(oldSocketId).emit('forced_logout');

                        // Proceed to login logic below
                    } else {
                        // Conflict Sequence
                        // Send Alert to Existing Admin
                        const oldSocketId = sessions[normalizedName].socketId;
                        io.to(oldSocketId).emit('admin_conflict_alert');

                        // Store this new socket as pending conflict
                        pendingAdminConflict = {
                            name: normalizedName,
                            message: message,
                            socketId: socket.id,
                            timer: setTimeout(() => {
                                // Timeout Reached: Allow Login
                                if (sessions[normalizedName]) {
                                    io.to(sessions[normalizedName].socketId).emit('forced_logout');
                                }
                                confirmAdminLogin(socket, normalizedName, message);
                                pendingAdminConflict = null;
                            }, 5000)
                        };
                        return; // Wait for timeout or rejection
                    }
                }

                confirmAdminLogin(socket, normalizedName, message);

            } else {
                if (password) socket.emit('error_message', 'Invalid Admin Password');
                else socket.emit('error_message', 'Invalid name, give another name');
            }
            return;
        }

        // Normal User
        // Check duplicate name
        // Case-insensitive check
        const existingUser = Object.keys(sessions).find(key => key.toLowerCase() === lowerName);
        if (existingUser) {
            const session = sessions[existingUser];
            if (session.connected) {
                socket.emit('error_message', 'Name is already taken. Please choose another.');
                return;
            }
            // If disconnected, allow reclaim? 
            // Without token, we shouldn't allow reclaim easily as it invites identity theft.
            socket.emit('error_message', 'Name is unavailable (reserved).');
            return;
        }

        // New Session
        const newToken = uuidv4();
        sessions[normalizedName] = {
            name: normalizedName,
            token: newToken,
            approved: false,
            isAdmin: false,
            connected: true,
            socketId: socket.id
        };

        // Notify Admin
        const adminSession = Object.values(sessions).find(s => s.isAdmin && s.connected);
        if (adminSession) {
            io.to(adminSession.socketId).emit('update_requests', [{ name: normalizedName, socketId: socket.id }]); // Just send all pending usually, but incremental is ok
            // Better: send full list
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId }));
            io.to(adminSession.socketId).emit('update_requests', pending);
        }

        socket.emit('waiting_approval_with_token', newToken); // Client saves token
    });

    socket.on('admin_conflict_response', (action) => {
        // Only active admin can send this
        if (pendingAdminConflict && action === 'refuse') {
            clearTimeout(pendingAdminConflict.timer);
            // Notify pending socket
            if (io.sockets.sockets.get(pendingAdminConflict.socketId)) {
                io.to(pendingAdminConflict.socketId).emit('error_message', 'Login refused by active Admin');
            }
            pendingAdminConflict = null;
        }
    });

    function confirmAdminLogin(sock, name, msg) {
        const newToken = uuidv4();
        sessions[name] = {
            name: "Admin", token: newToken, approved: true, isAdmin: true, connected: true, socketId: sock.id, message: msg || "I am Admin"
        };
        adminActive = true;

        sock.emit('login_success', { name: "Admin", isAdmin: true, token: newToken });
        sock.emit('load_messages', messages);

        const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, message: s.message }));
        sock.emit('update_requests', pending);
        io.emit('user_list', getActiveUserNames());
    }

    socket.on('admin_action', (data) => {
        // Check if sender is admin
        const adminSession = Object.values(sessions).find(s => s.socketId === socket.id && s.isAdmin);
        if (!adminSession) return;

        const targetName = data.name; // Use name as ID now since socketId changes
        const targetSession = sessions[targetName];

        if (targetSession) {
            if (data.action === 'approve') {
                targetSession.approved = true;
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('login_success', {
                        name: targetSession.name,
                        isAdmin: false,
                        token: targetSession.token
                    });
                    io.to(targetSession.socketId).emit('load_messages', messages);
                }
            } else if (data.action === 'reject') {
                if (targetSession.connected && targetSession.socketId) {
                    io.to(targetSession.socketId).emit('access_denied');
                    io.to(targetSession.socketId).emit('clear_token'); // Tell client to forget token
                }
                delete sessions[targetName];
            }

            // Update Admin UI
            const pending = Object.values(sessions).filter(s => !s.approved && !s.isAdmin).map(s => ({ name: s.name, socketId: s.socketId, message: s.message }));
            socket.emit('update_requests', pending);
            io.emit('user_list', getActiveUserNames());
        }
    });

    socket.on('send_message', (msgData) => {
        const senderSession = Object.values(sessions).find(s => s.socketId === socket.id);
        if (!senderSession || !senderSession.approved) return;

        const message = {
            id: Date.now().toString(),
            sender: senderSession.name,
            senderId: senderSession.token, // Use token as persistent ID for deletion rights
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
    });

    socket.on('logout_self', () => {
        const session = Object.values(sessions).find(s => s.socketId === socket.id);
        if (session) {
            // Remove from sessions so name can be reused and no auto-reconnect
            if (session.isAdmin) adminActive = false;
            delete sessions[session.name];

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
            session.connected = false;
            // We do NOT delete the session immediately to allow reload/reconnect.
            // But we might want to update the "User List" to show offline?
            // For now, keep it simple.
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

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
