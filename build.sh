#!/bin/bash
set -e
echo "Building Astro frontend..."
cd frontend
npm install
npm run build
echo "Backend ready at http://localhost:8000"
cd ../backend
mkdir -p data
python -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
