# PersonaPRO AI Photo Booth — Web Application (`webconvert`)

Transform your selfie into futuristic AI avatar portraits directly in any web browser! This is a complete, 1:1 responsive web conversion of the Flutter mobile app.

---

## 🌟 Key Features
- **1:1 Flutter Mobile App Design**: Authentic layout, deep space gradients (`#0F0C29` to `#302B63`), glassmorphic cards, and cyan neon glow (`#00F2FE`).
- **Live Camera / Webcam Stream**: Instant real-time video stream inside the circular frame with Flip Camera support (front/back camera).
- **Gallery & File Upload**: Drag-and-drop or file upload for photos up to 4K resolution (auto-downscaled to 1280px for high-speed transmission).
- **Live Master Templates Grid**: Fetches active event master templates (`12th Inspire Manak Exhibition`, etc.) directly from the backend API.
- **Ultra-Fast AI Generation**: Real-time progress updates with holographic particle rings and animated progress steps.
- **High-Definition Results**: Full-fidelity composite preview, direct download (`SAVE & FINISH`), and dynamic QR Code modal for instant mobile phone sharing.

---

## 🚀 How to Run Locally

### Option 1: Via the Existing Backend (Zero Setup!)
The web app is already integrated into the backend server:
1. Make sure the backend is running (`node index.js` in `backend/`).
2. Open your browser:
   - **Local Web App:** [http://localhost:5000/app](http://localhost:5000/app)
   - **WiFi Devices / Phone:** `http://192.168.1.8:5000/app`

### Option 2: Standalone Web Server
You can open `webconvert/index.html` directly in any modern browser, or run a local static server:
```bash
# Using Python
python -m http.server 3000

# Using Node.js (npx)
npx -y serve .
```
Then visit `http://localhost:3000` (or the port shown).

---

## 🌐 Live Production Deployment
When pushed to GitHub, it is also automatically live on Vercel:
- **Production Web App:** https://ai-camera-pi.vercel.app/app
- **Admin Dashboard:** https://ai-camera-pi.vercel.app/admin
