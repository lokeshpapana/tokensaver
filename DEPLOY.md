# TokenSaver v2.1 - Deployment Guide

## Quick Deploy (Free Tier)

### 1. Firebase Setup
1. Create Firebase project at https://console.firebase.google.com
2. Enable **Authentication** > Sign-in method > Email/Password, Google, Anonymous
3. Enable **Firestore Database** > Create database > Start in test mode
4. Get config: Project Settings > General > Your apps > Web app

### 2. Deploy Backend to Render
1. Push to GitHub
2. Render.com > New Web Service > Connect repo
3. Root: `backend/`
4. Build Command: `cd frontend && npm install && npm run build && cd ../backend && pip install -r requirements.txt`
5. Start Command: `cd backend && gunicorn app:app --workers 4 --bind 0.0.0.0:$PORT`
6. Environment Variables:
   - `FIREBASE_DEV_MODE=false`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (paste entire service account JSON)

### 3. Deploy Frontend to Vercel
1. Vercel.com > New Project > Import GitHub repo
2. Root: `frontend/`
3. Framework: Astro (auto-detected)
4. Environment Variables (from Firebase config):
   - `PUBLIC_FIREBASE_API_KEY`
   - `PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `PUBLIC_FIREBASE_PROJECT_ID`
   - `PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `PUBLIC_FIREBASE_APP_ID`
   - `VITE_API_BASE=https://your-backend.onrender.com/api`

### 4. Update Firebase Authorized Domains
Add both domains to Firebase Auth > Settings > Authorized domains:
- `your-frontend.vercel.app`
- `your-backend.onrender.com`

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

## Free Tier Limits

| Service | Free Limit |
|---------|------------|
| Render Web Service | 750 hrs/mo, spins down after 15min idle |
| Vercel | 100GB bandwidth, unlimited personal projects |
| Firebase Auth | 50K MAU |
| Firestore | 1GB storage, 50K reads/day, 20K writes/day |
| Firebase Hosting (alt) | 10GB storage, 360MB/day |

---

## Project Structure

```
tokensaver/
├── backend/
│   ├── app.py              # FastAPI + Firebase
│   ├── converter/
│   │   ├── firebase_security.py  # Auth, rate limiting, API keys
│   │   ├── renderer.py           # Optimized PNG generation
│   │   ├── tokenizer.py
│   │   ├── code_optimizer.py
│   │   ├── extractors.py
│   │   ├── history.py
│   │   └── security.py
│   ├── requirements.txt
│   └── render.yaml
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── firebase.ts     # Firebase init
│   │   │   ├── api.ts          # Authenticated API client
│   │   │   └── app.ts          # Main app logic
│   │   ├── pages/index.astro   # Main page
│   │   ├── components/         # Auth, modals, etc.
│   │   └── styles/global.css
│   ├── vercel.json
│   └── .env.example
├── build.bat / build.sh
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/estimate | Optional | Token estimate before convert |
| POST | /api/convert | Optional | Single file to PNG |
| POST | /api/convert-text | Optional | Paste text to PNG |
| POST | /api/convert-batch | Optional | Multiple files to ZIP |
| GET | /api/history | Optional | Conversion history |
| GET | /api/stats | Optional | User statistics |
| POST | /api/keys/generate | Required | Create API key |
| GET | /api/keys/list | Required | List user's API keys |
| POST | /api/keys/revoke | Required | Revoke API key |

---

## Rate Limits (per hour)

| Tier | Requests | File Size | Text Chars | Batch Files |
|------|----------|-----------|------------|-------------|
| Anonymous | 20 | 5MB | 1M | 5 |
| Free | 100 | 10MB | 50M | 20 |
| Pro | 500 | 50MB | 200M | 50 |

---

## Development Commands

```bash
# Build frontend for production
cd frontend && npm run build

# Test backend locally
cd backend && export FIREBASE_DEV_MODE=true && python -m uvicorn app:app --reload --port 8000

# Run tests
cd backend && python -m pytest
```

---

## Troubleshooting

**Firebase credentials not found:**
- Set `FIREBASE_SERVICE_ACCOUNT_JSON` env var on Render
- Or place `serviceAccountKey.json` in backend/

**CORS errors:**
- Add frontend domain to Firebase Auth authorized domains
- Check `allow_origins` in app.py CORS middleware

**Rate limit not working:**
- Verify Firestore is enabled in Firebase Console
- Check DEV_MODE is false in production

**Build fails:**
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node version (18+ required)