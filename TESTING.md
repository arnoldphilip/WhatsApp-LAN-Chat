# Testing Instructions

## 1. Preparation
- Ensure the server is running: `node server.js`
- Find your local IP address (e.g., `192.168.x.x`) to test across devices, or use `localhost` for local testing.

## 2. Admin & User Join Flow
1. **Admin Join**: Open `http://localhost:3000`. Enter a name (e.g., "Admin"). You should see the Chat Interface immediately.
2. **Guest Join**: Open an Incognito window or a different browser. Go to `http://localhost:3000`. Enter a name (e.g., "Guest").
   - **Expectation**: You should see "Wait for Admin Approval".
3. **Approval**: Go back to the **Admin** window. You should see "Guest" in the Admin Panel. Click **"✔ (Approve)"**.
   - **Expectation**: The Guest window should automatically update to show the Chat Interface.

## 3. Messaging & Features
- **Text**: Send a message from both users. Verify instant delivery.
- **Emoji**: Click the `😀` button. Select an emoji. It should appear in the input. Click outside to close the picker.
- **Mentions**: Type `@Guest` in the Admin window and send. Verify it is highlighted in blue.
- **Delete**: Hover over a message sent by **YOU**. A red `×` button should appear. Click it.
   - **Expectation**: The message content should be replaced with "🚫 This message was deleted by the sender".

## 4. File Sharing
- **Drag & Drop**: Drag an image file onto the page.
   - **Expectation**: The file input should detect it. Press "Send" to upload.
- **Preview**: Verify that images are shown, and other files appear as download links.

## 5. Session Management & Persistence
1. **End Session**: As Admin, click **"🛑 End Session"**.
2. **Prompt**:
   - Click **OK** to **SAVE** the chat history. (Check that `chat_data.json` is created in the project folder).
   - Click **Cancel** to **DELETE** history.
3. **Relogin**: Restart the server if needed. Join as Admin.
   - If Saved: Previous messages should load.
   - If Deleted: Chat should be empty.

## 6. Theme
- Click the **🌓** icon in the top right. Verify Dark Mode toggle works and persists after refresh.
