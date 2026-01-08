# Secure LAN Chat Application

A robust, real-time messaging application built with **Node.js**, **Express**, and **Socket.io**. Designed for local network (LAN) environments with a focus on security, admin control, and a premium user experience.

## 🚀 Features

### Core Messaging
*   **Real-time Communication**: Instant messaging using Socket.io.
*   **File Sharing**: Support for images, videos, and documents with drag-and-drop support.
*   **Image Editor**: Built-in crop and edit tool before sending images.
*   **Mentions**: Tag users with `@username`.
*   **Reply System**: Reply to specific messages.
*   **Message Deletion**: Users can delete their own messages.

### Security & Admin Control
*   **Admin Approval System**: New users must be approved by the Admin before joining.
*   **Secure Admin Login**: Hidden "Secret" login flow (Type `Admin` + `Shift+Enter`) protected by a password.
*   **Conflict Resolution**: Detects concurrent Admin logins and offers options to Refuse or Force Logout.
*   **Session Persistence**: Users remain logged in across reloads using secure tokens.
*   **Admin Actions**: Kick users, clear chat history, or save chat logs.

### UI/UX
*   **Responsive Design**: Fully adaptive layout for Desktop (immersive) and Mobile (full-screen app feel).
*   **Dark Mode**: Toggleable dark/light theme.
*   **Modern Aesthetics**: Glassmorphism effects, smooth animations, and a polished interface.

## 🛠️ Installation & Setup

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd whatsapp
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Start the Server**
    ```bash
    node server.js
    ```

4.  **Access the App**
    *   **Localhost**: `http://localhost:3000`
    *   **LAN**: `http://<YOUR_IP_ADDRESS>:3000`

## 🔑 Usage Guide

### Logging In
*   **Normal User**: Enter your desired name and an optional message. Wait for Admin approval.
*   **Admin**: 
    1. Enter the name **"Admin"**.
    2. Press **Shift + Enter**.
    3. Enter the password: `Wh@tme`.

### Admin Conflicts
If an Admin tries to log in while another session is active:
*   The active Admin gets a **Popup Warning** to "REFUSE" the login.
*   The new Admin can **Force Login** by pressing `Shift + Enter` on the password field.

## 📦 Tech Stack
*   **Frontend**: HTML5, CSS3 (Variables & Flexbox), Vanilla JavaScript.
*   **Backend**: Node.js, Express.
*   **Real-time Engine**: Socket.io.
*   **File Handling**: Multer.

## 🤝 Contributing
Feel free to fork this project and submit pull requests.

## 📄 License
MIT License.
