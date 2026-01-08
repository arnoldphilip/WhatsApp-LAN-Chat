const socket = io();

// State
let currentUser = null;
let isAdmin = false;
let replyToMessageId = null;
let userList = [];
let currentCropper = null;
let pendingFile = null;

// DOM Elements
const loginArea = document.getElementById('login-area');
const chatContainer = document.getElementById('chat-container');
const chatList = document.getElementById('chat');
const msgArea = document.getElementById('msg-area');
const adminPanel = document.getElementById('admin-panel');
const requestsList = document.getElementById('requests');
const waitingScreen = document.getElementById('waiting');
const msgInput = document.getElementById("msg");
const fileInput = document.getElementById("file-input");
const dropOverlay = document.getElementById("drop-area-overlay");
const editorModal = document.getElementById("image-editor-modal");
const imagePreview = document.getElementById("image-preview");
const passwordModal = document.getElementById("password-modal");
const passwordInput = document.getElementById("admin-password");
const adminToggleBtn = document.getElementById("admin-toggle-btn");
const requestsSection = document.getElementById("requests-section");
const adminActions = document.getElementById("admin-actions");

// Mentions Logic
let mentionPopup = document.createElement('div');
mentionPopup.className = 'mention-popup';
mentionPopup.style.display = 'none';
document.body.appendChild(mentionPopup);

// --- Initialization ---

if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
}

const existingToken = localStorage.getItem('chat_token');
const existingName = localStorage.getItem('chat_name');
if (existingToken && existingName) {
    socket.emit('join_request', { name: existingName, token: existingToken });
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}

const headerControls = document.querySelector('.header-controls');
const logoutBtn = document.createElement('button');
logoutBtn.innerText = '🚪';
logoutBtn.title = 'Logout';
logoutBtn.style.background = 'transparent';
logoutBtn.style.padding = '5px';
logoutBtn.onclick = handleLogout;
// Insert before theme button (which is last usually)
// Wait, we need to create theme button first if it didn't exist or we removed it.
const themeBtn = document.createElement('button');
themeBtn.innerText = '🌓';
themeBtn.style.background = 'transparent';
themeBtn.style.padding = '5px';
themeBtn.onclick = toggleTheme;
if (headerControls) {
    headerControls.appendChild(logoutBtn);
    headerControls.appendChild(themeBtn);
}

function handleLogout() {
    if (isAdmin) {
        // Simple Prompt for Admin
        if (confirm("Logout Options:\nOK = Logout Yourself Only\nCancel = Logout Everyone (End Session)")) {
            socket.emit('logout_self');
            localStorage.clear();
            location.reload();
        } else {
            // Check if user actually meant to cancel the whole action or pick option 2?
            // Confirm returns false on Cancel.
            // If they hit Cancel, we treat it as Option 2? RISKY.
            // Better: Custom Modal or simple `prompt`: "Type '1' for Self, '2' for All".
            // Or better: Use two buttons in a div?
            // Let's use a simple approach: 
            // 1. Click Logout -> Shows small popup with 2 buttons if Admin.
            showLogoutMenu();
        }
    } else {
        if (confirm("Are you sure you want to logout?")) {
            localStorage.clear();
            location.reload();
            // Server sees socket disconnect, logic handles it.
            // But to be clean, maybe emit 'logout_self' too?
            socket.emit('logout_self');
        }
    }
}

// Admin Logout Menu
const logoutMenu = document.createElement('div');
logoutMenu.className = 'logout-menu';
logoutMenu.style.display = 'none';
logoutMenu.style.position = 'absolute';
logoutMenu.style.top = '50px';
logoutMenu.style.right = '50px';
logoutMenu.style.background = 'var(--container-bg)'; // Use theme var
logoutMenu.style.border = '1px solid var(--secondary-text)';
logoutMenu.style.padding = '10px';
logoutMenu.style.zIndex = '100';
logoutMenu.innerHTML = `
    <button onclick="logoutSelf()" style="display:block; width:100%; text-align:left; font-size:14px; margin-bottom:5px;">Logout Self</button>
    <button onclick="logoutAll()" style="display:block; width:100%; text-align:left; font-size:14px; color:red;">Logout Everyone</button>
    <button onclick="closeLogoutMenu()" style="display:block; width:100%; text-align:center; font-size:12px; margin-top:5px; background:#ccc; color:black;">Cancel</button>
`;
document.body.appendChild(logoutMenu);

function showLogoutMenu() {
    logoutMenu.style.display = 'block';
}

window.closeLogoutMenu = function () {
    logoutMenu.style.display = 'none';
}

window.logoutSelf = function () {
    socket.emit('logout_self');
    localStorage.clear();
    location.reload();
}

window.logoutAll = function () {
    // Re-use End Session Logic
    if (confirm("Save chat history before ending?\nOK = Save & End\nCancel = Delete & End")) {
        socket.emit('end_session', 'save');
    } else {
        socket.emit('end_session', 'delete');
    }
}

let sessionBtn = null;

// --- Socket Events ---
socket.on('connect', () => {
    console.log('Connected');
    if (existingToken && existingName && !currentUser) {
        socket.emit('join_request', { name: existingName, token: existingToken });
    }
});

socket.on('login_success', (data) => {
    currentUser = data.name;
    isAdmin = data.isAdmin;

    localStorage.setItem('chat_name', data.name);
    localStorage.setItem('chat_token', data.token);

    loginArea.style.display = 'none';
    waitingScreen.style.display = 'none';
    msgArea.style.display = 'flex';
    passwordModal.style.display = 'none';

    if (isAdmin) {
        // Show Admin UI Toggle
        adminToggleBtn.style.display = 'block';
        // Initialize controls but don't show panel yet unless requests exist
        addAdminControls();
    }
});

socket.on('require_password', () => {
    passwordModal.style.display = 'flex';
    passwordInput.focus();
});

socket.on('waiting_approval', () => {
    loginArea.style.display = 'none';
    waitingScreen.style.display = 'block';
});
socket.on('waiting_approval_with_token', (token) => {
    loginArea.style.display = 'none';
    waitingScreen.style.display = 'block';
    localStorage.setItem('chat_name', document.getElementById('name').value.trim());
    localStorage.setItem('chat_token', token);
});


socket.on('access_denied', () => {
    alert("You are not allowed to join this chat.");
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_name');
    location.reload();
});

socket.on('error_message', (msg) => {
    alert(msg);
});

socket.on('clear_token', () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_name');
});

socket.on('load_messages', (messages) => {
    chatList.innerHTML = '';
    messages.forEach(msg => renderMessage(msg));
    scrollToBottom();
});

socket.on('new_message', (msg) => {
    renderMessage(msg);
    scrollToBottom();
});

socket.on('message_deleted', (msgId) => {
    const li = document.getElementById(`msg-${msgId}`);
    if (li) {
        li.innerHTML = `<span style="font-style:italic; color:#888;">🚫 This message was deleted by the sender</span>`;
    }
});

socket.on('update_requests', (requests) => {
    if (!isAdmin) return;

    requestsList.innerHTML = '';

    if (requests.length > 0) {
        // Auto Show Panel
        adminPanel.style.display = 'block';
        requestsSection.style.display = 'block';

        requests.forEach(req => {
            const div = document.createElement('div');
            div.style.padding = '8px';
            div.style.borderBottom = '1px solid #eee';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.innerHTML = `
                <span style="font-weight:500">${req.name}</span>
                <div>
                    <button onclick="approve('${req.name}')" style="background:#25d366; padding:4px 10px; font-size:14px; margin-right:5px;">✔</button>
                    <button onclick="reject('${req.name}')" style="background:#ff4d4d; padding:4px 10px; font-size:14px;">✖</button>
                </div>
            `;
            requestsList.appendChild(div);
        });
    } else {
        requestsSection.style.display = 'none';
        // Check if admin panel should be hidden?
        // Logic: "show only when someone request". 
        // But user might look for "End Session".
        // If I hide it here, user has to click gear icon to find End Session.
        // That matches "otherwise it must not appear".
        // So yes, hide entire panel if no requests AND assuming we want to minimize it.
        // However, this might annoy Admin if they are in the middle of "End Session".
        // I will only hide requests section. Admin can close panel manually.
        // OR: If the panel was auto-opened, maybe auto-close? Hard to track.
        // Let's hide the REQUESTS SECTION. The panel remains open if user opened it, or we can close it.
        // Prompt: "show only when someone request otherwise it must not appear".
        // Strict interpretation: Panel gone.
        // Exception: "hover towards top... small button to show".
        // So: Default state is HIDDEN.
        // If Requests > 0 -> SHOW.
        // If Requests == 0 -> HIDE (unless user wants it? But prompt says "must not appear").
        // I'll auto-hide the panel if requests are 0.
        // Usage: Requests cleared -> Panel closes. Admin wants to End Session -> Clicks Gear -> Panel Opens (with no requests) -> Clicks End Session.
        adminPanel.style.display = 'none';
    }
});

socket.on('user_list', (users) => {
    userList = users.filter(u => u !== currentUser);
});

socket.on('admin_disconnected', () => {
    alert("Admin ended the session.");
    localStorage.clear();
    location.reload();
});

socket.on('session_ended', () => {
    alert("Session ended.");
    localStorage.clear();
    location.reload();
});

// --- Core Functions ---

window.toggleAdminPanel = function () {
    adminPanel.style.display = adminPanel.style.display === 'none' ? 'block' : 'none';
}

// --- Login & Admin Secret Flow ---

const loginScreen = document.getElementById('login-screen');
const loginNameInput = document.getElementById('login-name');
const loginMsgInput = document.getElementById('login-msg');
const nameError = document.getElementById('name-error');

let isAdminLogin = false;

// 1. Shift + Enter Secret (Name Box)
loginNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        if (loginNameInput.value.trim().toLowerCase() === 'admin') {
            triggerAdminMode();
        }
    }
});

// 2. Shift + Enter Secret (Password Box - Force Login)
loginMsgInput.addEventListener('keydown', (e) => {
    if (isAdminLogin && e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        join(true); // true = force
    } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent newline in password/msg box if we want it to submit
        join(false);
    }
});

// 2. Blur / Focus 2nd Box Logic
loginNameInput.addEventListener('blur', checkNameValidity);
// Also check when user tries to interact with msg box
loginMsgInput.addEventListener('focus', checkNameValidity);

function checkNameValidity() {
    const val = loginNameInput.value.trim().toLowerCase();

    // If name is "admin" BUT we haven't activated admin mode (secret key)
    if (val === 'admin' && !isAdminLogin) {
        showNameError("Invalid name, give another name");
        loginNameInput.value = ""; // Optional: Clear to force retry? Prompt says "Immediately say invalid name"
    }
    // We can't check duplicates locally without server ping, but server will reject. 
    // Prompt says "same invalid name error must come if people inside... same name". 
    // This implies we rely on server response 'error_message' to show this same UI.
}

function showNameError(msg) {
    nameError.innerText = msg;
    nameError.style.display = 'block';
    // Shake animation? 
    loginNameInput.style.borderColor = 'red';
    setTimeout(() => {
        nameError.style.display = 'none';
        loginNameInput.style.borderColor = '#ccc';
    }, 3000);
}

function triggerAdminMode() {
    isAdminLogin = true;
    loginMsgInput.type = 'password';
    loginMsgInput.placeholder = "Enter password to enter as admin";
    loginMsgInput.focus();
}

function join(force = false) {
    const name = loginNameInput.value.trim();
    if (!name) return;

    // Final check before sending
    if (name.toLowerCase() === 'admin' && !isAdminLogin) {
        showNameError("Invalid name, give another name");
        return;
    }

    const payload = {
        name,
        message: loginMsgInput.value.trim(),
        force: force
    };

    if (isAdminLogin) {
        payload.password = loginMsgInput.value.trim();
        // Clear message for admin (it's password)
        payload.message = "I am the Admin";
    }

    socket.emit('join_request', payload);
}

// --- Admin Conflict Logic ---
const conflictPopup = document.getElementById('conflict-popup');
const conflictTimer = document.getElementById('conflict-timer');
let conflictInterval = null;

socket.on('admin_conflict_alert', () => {
    conflictPopup.style.display = 'block';
    let timeLeft = 5;
    conflictTimer.innerText = timeLeft;

    if (conflictInterval) clearInterval(conflictInterval);
    conflictInterval = setInterval(() => {
        timeLeft--;
        conflictTimer.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(conflictInterval);
            conflictPopup.style.display = 'none';
            // Auto logout handled by server sending 'session_ended' or similar logic
        }
    }, 1000);
});

window.refuseLogin = function () {
    clearInterval(conflictInterval);
    conflictPopup.style.display = 'none';
    socket.emit('admin_conflict_response', 'refuse');
}

socket.on('forced_logout', () => {
    alert("You have been logged out because Admin logged in from another device.");
    localStorage.clear();
    location.reload();
});


// --- Socket Events Updates ---

socket.on('login_success', (data) => {
    currentUser = data.name;
    isAdmin = data.isAdmin;

    localStorage.setItem('chat_name', data.name);
    localStorage.setItem('chat_token', data.token);

    // Hide Login Screen
    loginScreen.style.display = 'none';
    waitingScreen.style.display = 'none';

    // Show Chat UI logic
    document.getElementById('msg-area').style.display = 'flex';
    passwordModal.style.display = 'none'; // Legacy modal, just in case

    if (isAdmin) {
        adminToggleBtn.style.display = 'block';
        addAdminControls();
    }
});

socket.on('waiting_approval', () => {
    loginScreen.style.display = 'none';
    waitingScreen.style.display = 'block';
});
socket.on('waiting_approval_with_token', (token) => {
    loginScreen.style.display = 'none';
    waitingScreen.style.display = 'block';
    localStorage.setItem('chat_name', loginNameInput.value.trim());
    localStorage.setItem('chat_token', token);
});

socket.on('error_message', (msg) => {
    // If we are on login screen, show it there
    if (loginScreen.style.display !== 'none') {
        showNameError(msg);
    } else {
        alert(msg);
    }
});

socket.on('require_password', () => {
    // Legacy support or if server asks. 
    // Our new flow handles password in initial request.
    // If logic falls back here, show old modal? 
    // Better: alert "Password Required" if somehow failed?
    // With new flow, this shouldn't trigger if we sent password correctly.
    // But if we joined as "Admin" without password (manually bypassing UI check?), server asks.
    // We can reuse the UI flow:
    triggerAdminMode();
    showNameError("Password required for Admin");
});

socket.on('update_requests', (requests) => {
    if (!isAdmin) return;

    requestsList.innerHTML = '';

    if (requests.length > 0) {
        adminPanel.style.display = 'block';
        requestsSection.style.display = 'block';

        requests.forEach(req => {
            const div = document.createElement('div');
            div.style.padding = '8px';
            div.style.borderBottom = '1px solid #eee';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            // Show Message
            const msgHtml = req.message ? `<div style="font-size:12px; color:#666; font-style:italic;">"${req.message}"</div>` : '';

            div.innerHTML = `
                <div>
                    <span style="font-weight:500">${req.name}</span>
                    ${msgHtml}
                </div>
                <div>
                    <button onclick="approve('${req.name}')" style="background:#25d366; padding:4px 10px; font-size:14px; margin-right:5px;">✔</button>
                    <button onclick="reject('${req.name}')" style="background:#ff4d4d; padding:4px 10px; font-size:14px;">✖</button>
                </div>
            `;
            requestsList.appendChild(div);
        });
    } else {
        requestsSection.style.display = 'none';
        adminPanel.style.display = 'none';
    }
});

// Remove old submitPassword / closePasswordModal logic if handled by new UI
// But keeping closePasswordModal for safety if legacy modal pops up.


window.approve = function (name) { // Make global
    socket.emit('admin_action', { action: 'approve', name });
}

window.reject = function (name) {
    socket.emit('admin_action', { action: 'reject', name });
}

function addAdminControls() {
    if (sessionBtn) return;
    sessionBtn = document.createElement('button');
    sessionBtn.innerText = "🛑 End Session";
    sessionBtn.className = "end-session-btn"; // Use Data-Driven Class
    sessionBtn.onclick = () => {
        if (confirm("Save chat history before ending?\nOK = Save & End\nCancel = Delete & End")) {
            socket.emit('end_session', 'save');
        } else {
            socket.emit('end_session', 'delete');
        }
    };
    adminActions.appendChild(sessionBtn);
}


// --- Message Sending ---

function send() {
    const text = msgInput.value.trim();
    if (!text && !pendingFile) return;

    if (pendingFile) {
        uploadAndSend(pendingFile, text);
    } else {
        socket.emit('send_message', { text, replyTo: replyToMessageId });
        clearInput();
    }
}

function uploadAndSend(file, text) {
    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            socket.emit('send_message', { text, file: data, replyTo: replyToMessageId });
            clearInput();
        })
        .catch(err => console.error("Upload Error:", err));
}

function clearInput() {
    msgInput.value = '';
    msgInput.placeholder = 'Message or Emoji...';
    fileInput.value = '';
    pendingFile = null;
    replyToMessageId = null;
}

// --- Image Handling ---

window.sendFileHandler = function (input) {
    if (input.files && input.files[0]) {
        handleFileSelection(input.files[0]);
    }
}

function handleFileSelection(file) {
    if (file.type.startsWith('image/')) {
        pendingFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            editorModal.style.display = 'flex';
            if (currentCropper) currentCropper.destroy();
            currentCropper = new Cropper(imagePreview, {
                viewMode: 2,
                autoCropArea: 1,
            });
        };
        reader.readAsDataURL(file);
    } else {
        pendingFile = file;
        msgInput.placeholder = `📄 ${file.name} attached`;
        msgInput.value += ` [File: ${file.name}]`;
    }
}

window.cropImage = function () {
    if (currentCropper) {
        currentCropper.getCroppedCanvas().toBlob((blob) => {
            const croppedFile = new File([blob], pendingFile.name, { type: pendingFile.type });
            pendingFile = croppedFile;
            uploadAndSend(pendingFile, msgInput.value);
            editorModal.style.display = 'none';
        });
    }
}

window.sendOriginal = function () {
    uploadAndSend(pendingFile, msgInput.value);
    editorModal.style.display = 'none';
}

window.cancelImage = function () {
    editorModal.style.display = 'none';
    pendingFile = null;
    fileInput.value = '';
    if (currentCropper) currentCropper.destroy();
}


// --- Drag & Drop Robust Fix ---

let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropOverlay.style.display = 'flex';
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
        dropOverlay.style.display = 'none';
        dragCounter = 0;
    }
});

window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropOverlay.style.display = 'flex';
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter = 0;
    dropOverlay.style.display = 'none';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileSelection(files[0]);
    }
});


// --- Mentions ---

msgInput.addEventListener('keyup', (e) => {
    const val = msgInput.value;
    const lastAt = val.lastIndexOf('@');

    if (lastAt !== -1) {
        const query = val.substring(lastAt + 1);
        if (query.match(/\s/)) {
            mentionPopup.style.display = 'none';
            return;
        }

        const matches = userList.filter(u => u.toLowerCase().startsWith(query.toLowerCase()));
        if (matches.length > 0) {
            showMentionPopup(matches, lastAt);
        } else {
            mentionPopup.style.display = 'none';
        }
    } else {
        mentionPopup.style.display = 'none';
    }
});

function showMentionPopup(matches, atIndex) {
    mentionPopup.innerHTML = '';
    mentionPopup.style.display = 'block';

    const rect = msgInput.getBoundingClientRect();
    mentionPopup.style.left = rect.left + 'px';
    mentionPopup.style.bottom = (window.innerHeight - rect.top + 5) + 'px';

    matches.forEach(name => {
        const div = document.createElement('div');
        div.innerText = name;
        div.onclick = () => {
            const val = msgInput.value;
            const before = val.substring(0, atIndex);
            msgInput.value = before + '@' + name + ' ';
            mentionPopup.style.display = 'none';
            msgInput.focus();
        };
        mentionPopup.appendChild(div);
    });
}

// --- Common UI ---

function renderMessage(msg) {
    const li = document.createElement('li');
    li.id = `msg-${msg.id}`;
    li.className = msg.senderId === localStorage.getItem('chat_token') ? 'outgoing' : 'incoming';

    let formattedText = msg.text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    let fileHtml = '';
    if (msg.file) {
        const { url, type, name } = msg.file;
        if (type.startsWith('image/')) {
            fileHtml = `<img src="${url}" class="media-content" onclick="window.open('${url}')">`;
        } else if (type.startsWith('video/')) {
            fileHtml = `<video src="${url}" controls class="media-content"></video>`;
        } else {
            fileHtml = `<div class="file-attachment"><a href="${url}" download="${name}">📄 ${name}</a></div>`;
        }
    }

    const canDelete = msg.senderId === localStorage.getItem('chat_token') && !msg.deleted;
    const deleteBtn = canDelete ? `<button class="delete-btn" onclick="deleteMessage('${msg.id}')">×</button>` : '';

    const content = msg.deleted ?
        `<span style="font-style:italic; color:#888;">🚫 This message was deleted by the sender</span>` :
        `
        <div class="sender-name">${msg.sender}</div>
        ${fileHtml}
        <div class="msg-text">${formattedText}</div>
        ${deleteBtn}
        `;

    li.innerHTML = `<div class="bubble">${content}</div>`;
    chatList.appendChild(li);
}

window.deleteMessage = function (msgId) {
    if (confirm("Delete this message?")) {
        socket.emit('delete_message', msgId);
    }
}

function scrollToBottom() {
    chatList.scrollTop = chatList.scrollHeight;
}

const emojiList = ['😀', '😂', '😍', '🥺', '😎', '👍', '👎', '🎉', '🔥', '❤️', '👀', '✅'];
let emojiPicker = document.querySelector('.emoji-picker');
if (!emojiPicker) {
    emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.style.display = 'none';
    emojiPicker.innerHTML = emojiList.map(e => `<span onclick="addEmoji('${e}')">${e}</span>`).join('');
    document.querySelector('.input-area').appendChild(emojiPicker);
}

window.toggleEmojiPicker = function () {
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
}

window.addEmoji = function (emoji) {
    msgInput.value += emoji;
    msgInput.focus();
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-btn') && !e.target.closest('.emoji-picker')) {
        emojiPicker.style.display = 'none';
    }
});
