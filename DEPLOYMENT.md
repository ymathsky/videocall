# How to Deploy to cPanel Hosting (Check for "Setup Node.js App")

Most shared hosting (like GoDaddy, Namecheap, Bluehost) uses **cPanel**. To run this video call system, your hosting plan **must** support Node.js applications.

## Step 1: Check for Node.js Support
1. Log in to your cPanel dashboard.
2. Search for an icon named **"Setup Node.js App"** or **"Node.js"**.
   - ✅ **If you see it:** Great! Follow **Step 2**.
   - ❌ **If you don't:** You cannot host this app directly on this hosting plan. You will need a VPS (like DigitalOcean) or a free cloud service like [Render](https://render.com) or [Glitch](https://glitch.com).

---

## Step 2: Create the Node.js Application
1. Click **"Setup Node.js App"**.
2. Click **"Create Application"**.
3. **Node.js Version:** Select the latest available version (e.g., 18.x or 20.x).
4. **Application Mode:** Select **Production**.
5. **Application Root:** Type a folder name where your app will live (e.g., `videocall-app`).
6. **Application URL:** Select your domain and type a subpath if desired (e.g., `videocall`).
7. **Application Startup File:** Type `server.js`.
8. Click **Create**.

## Step 3: Upload Your Files
1. Go to **File Manager** in cPanel.
2. Open the folder you created in the step above (e.g., `videocall-app`).
3. Upload the following files from your computer:
   - `server.js`
   - `package.json`
   - `index.html`
   - `style.css`
   - `script.js`
   - `README.md`
4. **DO NOT** upload the `node_modules` folder.

## Step 4: Install Dependencies
1. Go back to the **"Setup Node.js App"** page in cPanel.
2. Find your application and click the **Pencil icon** to edit.
3. Scroll down to see a button labeled **"Run NPM Install"**. Click it.
   - *Wait for it to complete successfully.*

## Step 5: Start the App
1. On the same page, click **"Restart"** or **"Start"**.
2. Visit your URL (e.g., `yourdomain.com/videocall`).
3. Your video call app should be live! 🎥

---

## Troubleshooting
- **"Application Error" or "Passenger Error":**
  - Check the **Log file** (often in the same folder).
  - Ensure `server.js` is named correctly in the settings.
  - Make sure you clicked "Run NPM Install".
- **Socket connection fails:**
  - In `script.js`, make sure you are using `const socket = io();` (which connects to the same domain/port automatically).
  - Ensure your site is using **HTTPS** (WebRTC requires HTTPS to work on real domains). If your site is HTTP, the camera will not open.
