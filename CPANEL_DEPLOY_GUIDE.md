# 🚀 PersonaPRO — cPanel Deployment Guide (Step-by-Step)

Yeh guide aapko cPanel pe **PersonaPRO AI Photo Booth** deploy karne me madad karegi.

---

### Step 1: cPanel me "Setup Node.js App" kholein
1. Apne **cPanel** me login karein.
2. Search bar me type karein **"Node.js"** aur **"Setup Node.js App"** par click karein.
3. **"Create Application"** button dabayein.

---

### Step 2: Application Settings Configure Karein
- **Node.js version:** `18.x` ya `20.x` (Recommended: `20.x` or latest LTS)
- **Application mode:** `Production`
- **Application root:** `ai_persona_app` (ya jo bhi folder name aap chahein)
- **Application URL:** Apna domain ya subdomain select karein (e.g., `booth.yourdomain.com` ya `yourdomain.com`)
- **Application startup file:** `index.js` (ya `app.js`)
- Click **"Create"**.

---

### Step 3: Zip File Upload aur Extract Karein
1. cPanel dashboard me wapas jayein aur **File Manager** kholein.
2. Apne application root folder me jayein (e.g. `/home/username/ai_persona_app`).
3. Top bar se **"Upload"** click karein aur **`cpanel_deployment.zip`** upload karein.
4. Upload complete hone ke baad zip file par right-click karein aur **"Extract"** karein.
5. Extract hone ke baad check karein ki saari files (`index.js`, `package.json`, `public/`, `uploads/`, `.env`) wahi folder me hain.

---

### Step 4: Dependencies Install Karein ("Run NPM Install")
1. Wapas cPanel ke **"Setup Node.js App"** page par aayein aur apni app ko edit karein.
2. Waha **"Run NPM Install"** button dikhega, uspe click karein.
   *(Yeh Linux ke compatible packages jaise `sharp`, `express`, `mongoose` automatically install kar dega).*
3. Agar aapke paas **Terminal / SSH** access hai, toh aap yeh command bhi chala sakte hain:
   ```bash
   cd /home/username/ai_persona_app
   npm install --production
   ```

---

### Step 5: Environment Variables (.env) Check Karein
File Manager me `.env` file ko edit karke apna domain update kar sakte hain:
- `APP_PUBLIC_URL=https://yourdomain.com`
- `MONGODB_URI=mongodb+srv://aipersona:aipersona@cluster0.g4wl0mi.mongodb.net/aipersona?retryWrites=true&w=majority&appName=Cluster0`
- `GEMINI_API_KEY=AIzaSyADEyKUsr1yoEUJhxsAGNXE4WU0p-cAypk`

---

### Step 6: Application Restart Karein
1. **"Setup Node.js App"** me jaakar **"Restart Application"** button dabayein.
2. Ab apna domain open karein:
   - 📸 **Photobooth Terminal:** `https://yourdomain.com/app/`
   - ⚙️ **Admin Panel:** `https://yourdomain.com/admin.html`
   - 🟢 **API Health Status:** `https://yourdomain.com/`

---

### 💡 Important Notes:
- `uploads/` folder ko write permissions (`755` ya `775`) honi chahiye taaki naye photos aur templates save ho sakein.
- MongoDB Atlas already cloud me configured hai, isliye database cloud se directly connect ho jayega.
