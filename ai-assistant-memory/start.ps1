# Start AI Assistant with Memory
# Run this script from the ai-assistant-memory directory

Write-Host "Starting AI Assistant with Memory..." -ForegroundColor Cyan

$rootDir = $PSScriptRoot
$venv = "$rootDir\venv313"
$backendDir = "$rootDir\backend"
$frontendDir = "$rootDir\frontend"

# Check venv exists
if (-not (Test-Path "$venv\Scripts\python.exe")) {
    Write-Host "ERROR: Virtual environment not found at $venv" -ForegroundColor Red
    Write-Host "Run setup first: python -m venv venv313 && .\venv313\Scripts\python.exe -m pip install -r backend\requirements.txt" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Starting Backend (FastAPI) on http://localhost:8000 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendDir'; '$venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

Start-Sleep -Seconds 2

Write-Host "Starting Frontend (React/Vite) on http://localhost:5173 ..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$frontendDir'; npm run dev"

Write-Host ""
Write-Host "Both servers launching! Open http://localhost:5173 in your browser." -ForegroundColor Cyan
Write-Host "Backend API docs at http://localhost:8000/docs" -ForegroundColor Cyan
