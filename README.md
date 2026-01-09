# 🚀 WhatsApp LAN Chat (Stable v2.0)

A premium, responsive, real-time messaging application designed for local networks. Features a modern WhatsApp-style UI, admin controls, and session persistence.

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
*   **📱 Fully Responsive**: Native app feel on both Desktop and Mobile.
*   **🛡️ Admin Control**: Secure approval system for new users.
*   **📁 File Sharing**: Drag & drop images/videos with built-in cropping.
*   **🗑️ Message Management**: Right-click to delete with a 5-second **Undo** safety net.
*   **😀 Smart Emojis**: Hover/Toggle picker with cursor-position insertion.
*   **🌙 Dark Mode**: Premium dark/light themes that persist across reloads.
*   **💾 Persistent Sessions**: Users stay logged in even if the page is refreshed.

---

### **🛠️ Admin Commands**
*   **Admin Name:** `Admin` (Case insensitive)
*   **Admin Password:** `Wh@tme`
*   **Permissions:** Approve/Reject users, End Sessions, Save/Clear chat history.

---

### **📂 Project Structure**
*   `server.js`: Node.js Express/Socket.io backend.
*   `chat.js`: Core frontend logic & UI interactions.
*   `style.css`: Premium themes & responsive layouts.
*   `index.html`: Optimized semantic structure.

---
*Legacy version (v1.0) is available on the `legacy-v1` branch.*
