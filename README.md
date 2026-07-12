# TokenSaver v2.1 - Cut LLM Token Costs by 89%

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Deploy](https://img.shields.io/badge/deploy-Render%20%7C%20Vercel-purple)

**Convert text files to dense PNG images. Slash LLM token costs by up to 89%.**

---

## 🚀 Live Demo

| Service | URL | Status |
|---------|-----|--------|
| **Frontend (Vercel)** | [tokensaver.vercel.app](https://tokensaver.vercel.app) | [![Vercel](https://vercelbadge.vercel.app/api/lokeshpapana/tokensaver)](https://vercel.com/lokeshpapana/tokensaver) |
| **Backend (Render)** | [tokensaver.onrender.com](https://tokensaver.onrender.com) | [![Render](https://img.shields.io/render/deployed/lokeshpapana/tokensaver)](https://dashboard.render.com/web/srv-tokensaver) |
| **API Docs** | [tokensaver.onrender.com/docs](https://tokensaver.onrender.com/docs) | 📖 |

> **After deploying, update the URLs above in this line  in DEPLOY.md and README.md**

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔥 **Firebase Auth** | Email/Password, Google, Anonymous sign-in |
| 📦 **Firestore API Keys** | Persistent, per-user, usage tracking |
| ⚡ **Smart Rate Limiting** | Sliding window, per-tier, survives restarts |
| 🎯 **Optimized Renderer** | 3x faster (0.7s), zero whitespace, smart sizing |
| 📦 **Real ZIP Download** | JSZip bundles actual ZIP archives |
| 📊 **Progress Ring** | Circular progress with live time estimate |
| 💾 **IndexedDB History** | Offline-first, view/download/copy/delete |
| 🔮 **Pre-conversion Estimate** | Real-time token calc, warns if image costs more |
| 📱 **Responsive UI** | Dark theme, drag-drop, paste, batch upload |

---

## 📦 Quick Deploy (Free Tier)

### 1. Firebase Setup
1. Create project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password, Google, Anonymous
3. Enable **Firestore Database** → Start in test mode
4. Get config: Project Settings → General → Web app

### 2. Backend → Render
```bash
# Render.com → New Web Service → Connect this repo
# Root Directory: backend/
# Build: cd frontend && npm install && npm run build && cd ../backend && pip install -r requirements.txt
# Start: cd backend && gunicorn app:app --workers 4 --bind 0.0.0.0:$PORT
```
**Environment Variables:**
| Key | Value |
|-----|-------|
| `FIREBASE_DEV_MODE` | `false` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | (paste full service account JSON) |

### 3. Frontend → Vercel
```bash
# Vercel.com → New Project → Import this repo
# Root Directory: frontend/
```
**Environment Variables:**
| Key | Value |
|-----|-------|
| `PUBLIC_FIREBASE_API_KEY` | `your-api-key` |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
| `PUBLIC_FIREBASE_PROJECT_ID` | `your-project-id` |
| `PUBLIC_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `123456789` |
| `PUBLIC_FIREBASE_APP_ID` | `1:123456789:web:abcdef` |
| `VITE_API_BASE` | `https://your-backend.onrender.com/api` |

### 4. Firebase Authorized Domains
Add both to **Auth → Settings → Authorized domains:**
- `your-frontend.vercel.app`
- `your-backend.onrender.com`

---

## 🏃 Local Development

```bash
# Terminal 1: Backend
cd backend
export FIREBASE_DEV_MODE=true
python -m uvicorn app:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

---

## 📊 Rate Limits (per hour)

| Tier | Requests | File Size | Text Chars | Batch Files |
|------|----------|-----------|------------|-------------|
| Anonymous | 20 | 5MB | 1M | 5 |
| Free | 100 | 10MB | 50M | 20 |
| Pro | 500 | 50MB | 200M | 50 |

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Astro, TypeScript, Firebase SDK |
| **Backend** | FastAPI, Python 3.11 |
| **Auth/DB** | Firebase Auth, Firestore |
| **Deploy** | Render (API), Vercel (Static) |
| **Renderer** | PIL/Pillow, optimized PNG |

---

## 📄 License

MIT License - feel free to use, modify, and distribute.

---

## ⭐ Star History

If TokenSaver saves you tokens, give it a star!

[![Star History Chart](https://api.star-history.com/svg?repos=lokeshpapana/tokensaver&type=Date)](https://star-history.com/#lokeshpapana/tokensaver&Date)