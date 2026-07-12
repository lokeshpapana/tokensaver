@echo off
echo Building Astro frontend...
cd frontend
call npm install
call npm run build
cd ..\backend
if not exist data mkdir data
echo Starting server at http://localhost:8000
python -m uvicorn app:app --reload --host 0.0.0.0 --port 8000
