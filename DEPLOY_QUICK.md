# One-Click Deploy Setup for TokenSaver

## Prerequisites (Run Once)

### 1. Firebase Setup
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create project → Enable **Authentication** (Email/Password, Google, Anonymous)
3. Create **Firestore Database** (Native mode)
4. Project Settings → General → Web App → Copy config

### 2. Render Setup (Backend)
1. Go to [Render Dashboard](https://dashboard.render.com)
2. New → Web Service → Connect GitHub → `lokeshpapana/tokensaver`
3. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `cd ../frontend && npm ci && npm run build && cd ../backend && pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --workers 4 --bind 0.0.0.0:$PORT`
4. Environment Variables:
   ```
   FIREBASE_DEV_MODE=false
   FIREBASE_SERVICE_ACCOUNT_JSON=<paste entire service account JSON>
   ```

### 3. Vercel Setup (Frontend)
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Add New Project → Import `lokeshpapana/tokensaver`
3. Root Directory: `frontend`
4. Framework: Astro (auto-detected)
4. Environment Variables:
   ```
   PUBLIC_FIREBASE_API_KEY=your-api-key
   PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   PUBLIC_FIREBASE_PROJECT_ID=your-project-id
   PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
   PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef
   VITE_API_BASE=https://your-backend.onrender.com/api
   ```

---

## Automatic Deployment (After Setup)

### GitHub Secrets (Required for Auto-Deploy)
Go to GitHub repo → Settings → Secrets → Actions → Add:

| Secret | Value |
|--------|-------|
| `RENDER_API_KEY` | From Render Account Settings |
| `RENDER_SERVICE_ID` | From Render service URL (srv-xxx) |
| `VERCEL_TOKEN` | From Vercel Account Settings → Tokens |
| `VERCEL_ORG_ID` | From Vercel Project Settings |
| `VERCEL_PROJECT_ID` | From Vercel Project Settings |

### Deploy on Every Push
```bash
git push origin main
# Triggers both workflows automatically
```

### Manual Trigger
GitHub → Actions → "Deploy Backend to Render" / "Deploy Frontend to Vercel" → Run workflow

---

## Local Development

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

## Quick Test

```bash
# Test backend health
curl https://your-backend.onrender.com/api/health

# Test conversion
curl -X POST https://your-backend.onrender.com/api/convert-text \
  -H "Content-Type: application/json" \
  -d '{"text": "hello world\n"*100, "mode": "dense"}'
```