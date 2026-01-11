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
const membersList = document.getElementById("members-list");
const adminActions = document.getElementById("admin-actions");
const logoutModal = document.getElementById("logout-modal");
const adminLogoutOptions = document.getElementById("admin-logout-options");
const contextMenu = document.getElementById("custom-context-menu");
const deleteConfirmModal = document.getElementById("delete-confirm-modal");
const undoToast = document.getElementById("undo-toast");

// Deletion State
let messageToDeleteId = null;
let deletionTimeout = null;
let pendingDeletions = new Map();

// Local Message Cache for Replies
let localMessages = new Map(); // id -> { sender, text }

// Mentions Logic
let mentionPopup = document.createElement('div');
mentionPopup.className = 'mention-popup';
document.body.appendChild(mentionPopup);

// Reply UI Elements
const replyPreview = document.getElementById('reply-preview');
const replyToName = document.getElementById('reply-to-name');
const replyToText = document.getElementById('reply-to-text');

// --- Initialization ---

if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark-mode');
}

// Global reconnect variables
const storedUserId = localStorage.getItem('chat_userid');
const storedToken = localStorage.getItem('chat_token');
const storedName = localStorage.getItem('chat_name');

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
logoutBtn.style.display = 'none'; // Hidden by default
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
    if (!currentUser) return; // safety guard
    logoutModal.style.display = 'flex';
    if (isAdmin) {
        adminLogoutOptions.style.display = 'flex';
    } else {
        adminLogoutOptions.style.display = 'none';
    }
}

window.closeLogoutModal = function () {
    logoutModal.style.display = 'none';
}

window.logoutSelf = function () {
    socket.emit('logout_self');
    localStorage.clear();
    location.reload();
}

window.logoutAll = function () {
    showEndSessionModal();
}

const endSessionModal = document.getElementById('end-session-confirm-modal');

window.showEndSessionModal = function () {
    endSessionModal.style.display = 'flex';
}

window.closeEndSessionModal = function () {
    endSessionModal.style.display = 'none';
}

window.executeEndSession = function (action) {
    socket.emit('end_session', action);
    closeEndSessionModal();
    closeLogoutModal();
}

let sessionBtn = null;

// --- Socket Events ---
socket.on('connect', () => {
    console.log('Connected');

    // Auto-reconnect if we have any identity
    if ((storedUserId || storedToken) && !currentUser) {
        socket.emit('join_request', {
            name: storedName,
            token: storedToken,
            userId: storedUserId
        });
    }
});

socket.on('login_success', (data) => {
    currentUser = data.name;
    isAdmin = data.isAdmin;

    localStorage.setItem('chat_name', data.name);
    localStorage.setItem('chat_token', data.token);
    if (data.userId) localStorage.setItem('chat_userid', data.userId);

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

    // Show logout button only after login
    logoutBtn.style.display = 'block';
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
    localStorage.setItem('chat_userid', token); // token and userId are initially the same
});


socket.on('access_denied', () => {
    alert("You are not allowed to join this chat.");
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_name');
    localStorage.removeItem('chat_userid');
    location.reload();
});

socket.on('user_removed', () => {
    alert("You have been removed from the chat.");
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_name');
    localStorage.removeItem('chat_userid');
    location.reload();
});

socket.on('error_message', (msg) => {
    alert(msg);
});

socket.on('clear_token', () => {
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_name');
    localStorage.removeItem('chat_userid');
});

socket.on('load_messages', (messages) => {
    chatList.innerHTML = '';
    localMessages.clear(); // Clear cache on reload
    messages.forEach(msg => {
        localMessages.set(msg.id, { sender: msg.sender, text: msg.text, deleted: msg.deleted }); // Store for replies
        renderMessage(msg);
    });
    scrollToBottom();
});

socket.on('new_message', (msg) => {
    localMessages.set(msg.id, { sender: msg.sender, text: msg.text, deleted: false });
    renderMessage(msg);
    scrollToBottom();
});

socket.on('message_deleted', (msgId) => {
    // 1. Update Local Cache
    const cached = localMessages.get(msgId);
    if (cached) {
        cached.deleted = true;
    }

    // 2. Update the deleted message bubble itself
    const li = document.getElementById(`msg-${msgId}`);
    if (li) {
        li.innerHTML = `<div class="bubble"><span style="font-style:italic; color:var(--text-secondary);">🚫 This message was deleted by the sender</span></div>`;
    }

    // 3. Reactively update any visible Reply Blocks referencing this message
    const replyBlocks = document.querySelectorAll(`.reply-block[onclick="scrollToMessage('${msgId}')"]`);
    replyBlocks.forEach(block => {
        const textSpan = block.querySelector('.reply-block-text');
        if (textSpan) textSpan.innerText = "🚫 Original message deleted";
    });

    // If this was our pending deletion, clean up state
    if (messageToDeleteId === msgId) {
        clearTimeout(deletionTimeout);
        undoToast.style.display = 'none';
        pendingDeletions.delete(msgId);
        messageToDeleteId = null;
    }
});


socket.on('update_requests', (requests) => {
    if (!isAdmin) return;

    requestsList.innerHTML = '';

    if (requests.length > 0) {
        adminPanel.style.display = 'block';
        requestsSection.style.display = 'block';

        requests.forEach(req => {
            const div = document.createElement('div');
            // Premium Row Styling
            div.style.padding = '12px 0';
            div.style.borderBottom = '1px solid var(--border-subtle)';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            div.innerHTML = `
                <span style="font-weight:500; font-size:15px; color:var(--text-primary);">${req.name}</span>
                <div style="display:flex; gap:8px;">
                     <button onclick="approve('${req.userId || req.name}')" 
                        class="approve-btn"
                        style="background:var(--success) !important; color:white !important; padding:6px 14px !important; border-radius:6px !important; font-size:13px !important; font-weight:600 !important; width:auto !important; height:auto !important;">
                        Accept
                     </button>
                    <button onclick="reject('${req.userId || req.name}')" 
                        class="reject-btn"
                        style="background:transparent !important; border:1px solid var(--danger) !important; color:var(--danger) !important; padding:6px 14px !important; border-radius:6px !important; font-size:13px !important; font-weight:600 !important; width:auto !important; height:auto !important;">
                        Decline
                    </button>
                </div>
            `;
            requestsList.appendChild(div);
        });
    } else {
        requestsSection.style.display = 'none';
        // Only hide panel if NO members section visible logic exists yet... 
        // For now, prompt logic implies auto-hide if empty, but we have member list now.
        // We will manage panel visibility separately or let user close it.
    }
});

socket.on('update_members', (members) => {
    if (!isAdmin) return;

    membersList.innerHTML = '';
    const activeMembers = members.filter(m => !m.isAdmin); // Exclude Admin self

    if (activeMembers.length > 0) {
        activeMembers.forEach(mem => {
            const div = document.createElement('div');
            // Consistent Premium Row Styling
            div.style.padding = '12px 0';
            div.style.borderBottom = '1px solid var(--border-subtle)';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';

            div.innerHTML = `
                <span style="font-weight:500; font-size:15px; color:var(--text-primary);">${mem.name}</span>
                <button onclick="removeMember('${mem.userId || mem.name}', '${mem.name}')" 
                    class="remove-btn"
                    style="background:transparent !important; border:1px solid var(--danger) !important; color:var(--danger) !important; padding:5px 12px !important; border-radius:6px !important; font-size:12px !important; font-weight:600 !important; width:auto !important; height:auto !important;">
                    Remove
                </button>
            `;
            membersList.appendChild(div);
        });
        document.getElementById('members-section').style.display = 'block';
    } else {
        document.getElementById('members-section').style.display = 'none';
        membersList.innerHTML = '<div style="padding:10px; color:var(--secondary-text); font-style:italic; font-size:13px;">No other members joined yet.</div>';
        document.getElementById('members-section').style.display = 'block'; // Show empty state
    }
});

socket.on('user_list', (users) => {
    userList = users.filter(u => u !== currentUser);
});

socket.on('admin_disconnected', () => {
    alert("Admin ended the session.");
    location.reload();
});

socket.on('session_ended', (choice) => {
    if (choice === 'save') {
        alert("Session saved and ended. You will be automatically reconnected when the server is back.");
    } else {
        alert("Session wiped and ended.");
        localStorage.clear();
    }
    location.reload();
});

// --- Core Functions ---

window.toggleAdminPanel = function () {
    adminPanel.style.display = adminPanel.style.display === 'none' ? 'block' : 'none';
}

function join() {
    const name = document.getElementById('name').value.trim();
    if (name) {
        const userId = localStorage.getItem('chat_userid');
        socket.emit('join_request', { name, userId });
    }
}

function submitPassword() {
    const name = document.getElementById('name').value.trim();
    const pass = passwordInput.value.trim();
    if (pass) {
        const userId = localStorage.getItem('chat_userid');
        socket.emit('join_request', { name, password: pass, userId });
    }
}

function closePasswordModal() {
    passwordModal.style.display = 'none';
    passwordInput.value = '';
}

window.approve = function (id) { // Make global
    socket.emit('admin_action', { action: 'approve', userId: id });
}

window.reject = function (id) {
    socket.emit('admin_action', { action: 'reject', userId: id });
}

window.removeMember = function (id, name) {
    if (confirm(`Are you sure you want to remove ${name || id} from the chat?`)) {
        socket.emit('admin_action', { action: 'remove', userId: id });
    }
}

function addAdminControls() {
    if (sessionBtn) return;
    sessionBtn = document.createElement('button');
    sessionBtn.innerText = "🛑 End Session";
    sessionBtn.className = "end-session-btn"; // Use Data-Driven Class
    sessionBtn.onclick = () => {
        showEndSessionModal();
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
    cancelReply(); // Clear reply state
}

// --- Reply Logic ---

window.triggerReplyFromContext = function () {
    const msgId = messageToDeleteId; // We reuse this variable from context menu
    contextMenu.style.display = 'none';

    const originalMsg = localMessages.get(msgId);
    if (!originalMsg) return;

    replyToMessageId = msgId;

    replyPreview.style.display = 'flex';
    replyToName.innerText = originalMsg.sender;
    replyToText.innerText = originalMsg.text || (originalMsg.file ? '[File Attachment]' : '');

    msgInput.focus();
}

window.cancelReply = function () {
    replyToMessageId = null;
    replyPreview.style.display = 'none';
    replyToName.innerText = '';
    replyToText.innerText = '';
}

window.scrollToReplyOrigin = function () {
    if (replyToMessageId) {
        scrollToMessage(replyToMessageId);
    }
}

window.scrollToMessage = function (msgId) {
    const el = document.getElementById(`msg-${msgId}`);

    if (!el) {
        alert("Message not found.");
        return;
    }

    // Check if message is already deleted
    const msgData = localMessages.get(msgId);
    if (msgData && msgData.deleted) {
        // Just highlight the "Deleted" placeholder and don't scroll/spotlight
        el.classList.add('message-highlight');
        setTimeout(() => el.classList.remove('message-highlight'), 2000);
        return;
    }

    // 1. Smooth Scroll to center
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 2. Spotlight & Focus Interaction
    const triggerSpotlight = () => {
        // Add spotlight to message and dim to the chat container
        el.classList.add('spotlight-active');
        chatList.classList.add('chat-dimmed');

        // 3. Cleanup after animation cycle (1.5s)
        setTimeout(() => {
            el.classList.remove('spotlight-active');
            chatList.classList.remove('chat-dimmed');
        }, 1500);
    };

    // If we didn't need to scroll much, trigger immediately. 
    // Otherwise, delay slightly to allow scroll to start/complete for best visual impact.
    const rect = el.getBoundingClientRect();
    const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;

    if (isInView) {
        triggerSpotlight();
    } else {
        // Wait for scroll to move the message before spotlighting
        setTimeout(triggerSpotlight, 300);
    }
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
    if (matches.length === 0) {
        mentionPopup.style.display = 'none';
        return;
    }
    mentionPopup.style.display = 'block';

    const rect = msgInput.getBoundingClientRect();
    // Position fixed above input
    const bottomPos = window.innerHeight - rect.top + 10;
    mentionPopup.style.left = rect.left + 'px';
    mentionPopup.style.bottom = bottomPos + 'px';

    matches.forEach(name => {
        const div = document.createElement('div');
        div.innerText = name;
        div.onclick = () => {
            const val = msgInput.value;
            const before = val.substring(0, atIndex);
            // Replace everything after @ with name + space
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

    let formattedText = (msg.text || '').replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    // Reply Block Logic
    let replyHtml = '';
    if (msg.replyTo) {
        const parent = localMessages.get(msg.replyTo);
        if (parent) {
            replyHtml = `
            <div class="reply-block" onclick="scrollToMessage('${msg.replyTo}')">
                <span class="reply-block-name">${parent.sender}</span>
                <span class="reply-block-text">${parent.deleted ? '🚫 Original message deleted' : (parent.text || '[File]')}</span>
            </div>`;
        } else {
            replyHtml = `
            <div class="reply-block">
                <span class="reply-block-name">Unknown</span>
                <span class="reply-block-text">Original message unavailable</span>
            </div>`;
        }
    }

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

    const content = msg.deleted ?
        `<span style="font-style:italic; color:var(--text-secondary);">🚫 This message was deleted by the sender</span>` :
        `
        ${replyHtml}
        <div class="sender-name">${msg.sender}</div>
        ${fileHtml}
        <div class="msg-text">${formattedText}</div>
        `;

    li.innerHTML = `<div class="bubble">${content}</div>`;

    // CONTEXT MENU EVENT (Right-click & Long-press for ALL, with varying options)
    if (!msg.deleted) {
        let pressTimer;

        const handleContext = (e) => {
            e.preventDefault();
            messageToDeleteId = msg.id; // Using this as 'Selected Message ID' for simplicity

            const isOwner = msg.senderId === localStorage.getItem('chat_token');
            // Show/Hide Delete Option based on ownership
            const deleteOption = document.getElementById('ctx-delete');
            if (deleteOption) deleteOption.style.display = isOwner ? 'block' : 'none';

            const x = e.clientX || (e.touches && e.touches[0].clientX);
            const y = e.clientY || (e.touches && e.touches[0].clientY);
            showContextMenu(x, y);
        };

        li.addEventListener('contextmenu', handleContext);

        // Mobile Long Press
        li.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => handleContext(e), 600);
        }, { passive: true });
        li.addEventListener('touchend', () => clearTimeout(pressTimer));
        li.addEventListener('touchmove', () => clearTimeout(pressTimer));
    }

    chatList.appendChild(li);
}

function showContextMenu(x, y) {
    contextMenu.style.display = 'block';

    // Prevent menu from going off-screen
    const menuWidth = contextMenu.offsetWidth || 160;
    const menuHeight = contextMenu.offsetHeight || 50;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    if (x + menuWidth > winWidth) x = winWidth - menuWidth - 10;
    if (y + menuHeight > winHeight) y = winHeight - menuHeight - 10;
    if (x < 0) x = 10;
    if (y < 0) y = 10;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

// Global Click to close context menu
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        contextMenu.style.display = 'none';
    }
});

window.showDeleteConfirm = function () {
    contextMenu.style.display = 'none';
    deleteConfirmModal.style.display = 'flex';
}

window.closeDeleteConfirm = function () {
    deleteConfirmModal.style.display = 'none';
    messageToDeleteId = null;
}

window.confirmDeletion = function () {
    const msgId = messageToDeleteId;
    closeDeleteConfirm();

    // Visual Deletion (Local only)
    const li = document.getElementById(`msg-${msgId}`);
    if (li) {
        pendingDeletions.set(msgId, li.innerHTML); // Backup for undo
        li.innerHTML = `<div class="bubble"><span style="font-style:italic; color:#888;">🚫 Message hidden (Deleting...)</span></div>`;
    }

    // Show Undo Toast
    undoToast.style.display = 'flex';

    // Start 5s timer
    deletionTimeout = setTimeout(() => {
        executeDeletion(msgId);
    }, 5000);
}

window.undoDeletion = function () {
    clearTimeout(deletionTimeout);
    undoToast.style.display = 'none';

    const msgId = messageToDeleteId;
    const li = document.getElementById(`msg-${msgId}`);
    if (li && pendingDeletions.has(msgId)) {
        li.innerHTML = pendingDeletions.get(msgId);
    }

    pendingDeletions.delete(msgId);
    messageToDeleteId = null;
}

function executeDeletion(msgId) {
    undoToast.style.display = 'none';
    socket.emit('delete_message', msgId);
    pendingDeletions.delete(msgId);
    messageToDeleteId = null;
}

function scrollToBottom() {
    chatList.scrollTop = chatList.scrollHeight;
}

const emojiList = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
    '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁', '👅', '👄', '💋', '🩸',
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️'
];

let emojiPicker = document.querySelector('.emoji-picker');
if (!emojiPicker) {
    emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.style.display = 'none';
    emojiPicker.innerHTML = emojiList.map(e => `<span onclick="addEmoji('${e}')">${e}</span>`).join('');

    // FIX: Append to msg-area specifically so it shows when chatting
    const msgAreaEl = document.getElementById('msg-area');
    if (msgAreaEl) {
        msgAreaEl.appendChild(emojiPicker);
    }
}

window.toggleEmojiPicker = function (e) {
    if (e) e.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
}

window.addEmoji = function (emoji) {
    const start = msgInput.selectionStart;
    const end = msgInput.selectionEnd;
    const text = msgInput.value;
    const before = text.substring(0, start);
    const after = text.substring(end);

    msgInput.value = before + emoji + after;

    // Move cursor to after the inserted emoji
    const newPos = start + emoji.length;
    msgInput.setSelectionRange(newPos, newPos);
    msgInput.focus();
}

// Stop propagation inside picker to prevent closing when clicking the tray/scrollbar
emojiPicker.addEventListener('click', (e) => {
    e.stopPropagation();
});

document.addEventListener('click', (e) => {
    // If picker is open
    if (emojiPicker.style.display === 'grid') {
        // If clicking outside picker, emoji button, and the message input
        if (!e.target.closest('.emoji-btn') && !e.target.closest('.emoji-picker') && !e.target.closest('#msg')) {
            emojiPicker.style.display = 'none';
        }
    }
});
