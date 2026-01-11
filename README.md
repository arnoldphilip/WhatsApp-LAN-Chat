# 🚀 LANChat (Stable v3.1)

A premium, responsive, real-time messaging application designed for local networks. Features a modern WhatsApp-style UI, deep interaction patterns, and robust admin management.

---

### **⚡ TL;DR - Quick Start**

1. **Install:** 
   ```bash
   npm install
   ```
2. **Launch:** 
   ```bash
   node server.js
   ```
3. **Connect:**
   *   **On PC:** `http://localhost:8000`
   *   **On Mobile:** `http://[YOUR_IP]:8000` (The server will show your IP on start!)

---

### **🌟 Top Features**
*   **↩️ Advanced Replies**: WhatsApp-style message quoting with **Spotlight Navigation** (Smooth scroll + Zoom spotlight).
*   **🏷️ @Mentions**: Intelligent tagging system with autocomplete popup for chat participants.
*   **📱 Fully Responsive**: Native app feel on both Desktop and Mobile.
*   **👥 Member Management**: Admin can manage a live member list (Add/Remove) with instant access termination.
*   **🛡️ Secure Admin**: Password-protected "Admin" identity with a full approval lobby.
*   **📁 File Sharing**: Drag & drop images/videos with built-in cropping and editing.
*   **🗑️ Smart Deletion**: Right-click to delete with a 5-second **Undo** safety net.
*   **✨ Premium UX**: Replaced all browser alerts with professional in-app confirmation modals.
*   **💾 Deep Persistence**: Session tokens ensure users stay logged in across refreshes and reconnections.

---

### **🆕 What's New (v3.0)**
*   **Spotlight Focus**: Every time you jump to a replied message, the chat dims and zooms into the original message for a premium "spotlight" feel.
*   **Stable Identity Mapping**: Fixed the "Socket Flood" issue; user lists and logs remain clean and accurate even during network flickers.
*   **Admin Power-Up**: Admins can now explicitly see and "Remove" any participant from the unified Admin Controls panel.
*   **Contextual Feedback**: Differentiated messaging for "Rejection" vs "Removal" to keep user experience transparent.

---

### **🛠️ Admin Commands**
*   **Admin Name:** `Admin`
*   **Admin Password:** `Wh@tme`
*   **Permissions:** Approve/Reject/Remove users, End Sessions, Save/Clear chat history.

---

### **📂 Project Structure**
*   `server.js`: Node.js Express/Socket.io backend with identity-mapped sessions.
*   `chat.js`: Complex frontend logic including Reply-to-ID mapping and Mention handling.
*   `style.css`: Modern styling with Spotlight-Zoom animations and Dark Mode support.

---
*Legacy version (v2.0) is available on the `legacy-v2` branch.*

