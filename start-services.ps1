#!/usr/bin/env powershell
# QuantumTrust Cloud - Automated Startup Script
# Run this script to start all services at once

param(
    [switch]$NoDocker = $false,
    [switch]$NoHardhat = $false
)

$projectRoot = "c:\Users\lenovo\Desktop\Quantumtrust-cloud(PQC)"
$ErrorActionPreference = "Continue"

# Colors for output
$Green = @{ForegroundColor = "Green"}
$Yellow = @{ForegroundColor = "Yellow"}
$Red = @{ForegroundColor = "Red"}
$Cyan = @{ForegroundColor = "Cyan"}

function Write-Section {
    param([string]$Text)
    Write-Host "`n" + ("=" * 60) @Green
    Write-Host "  $Text" @Green
    Write-Host ("=" * 60) @Green
}

function Write-Info {
    param([string]$Text)
    Write-Host "ℹ  $Text" @Cyan
}

function Write-Success {
    param([string]$Text)
    Write-Host "✓  $Text" @Green
}

function Write-Warning {
    param([string]$Text)
    Write-Host "⚠  $Text" @Yellow
}

function Write-Error {
    param([string]$Text)
    Write-Host "✗  $Text" @Red
}

# Check prerequisites
Write-Section "Checking Prerequisites"

# Check if running from correct directory
if (-not (Test-Path "$projectRoot\.env")) {
    Write-Error "Cannot find .env file at $projectRoot"
    Write-Info "Please ensure you have the correct project path"
    exit 1
}
Write-Success ".env file found"

# Check Node.js
$nodeVersion = & node --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Success "Node.js found: $nodeVersion"
} else {
    Write-Error "Node.js not found. Please install Node.js 18+"
    exit 1
}

# Check Docker (optional)
if (-not $NoDocker) {
    $dockerStatus = & docker ps 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker is running"
    } else {
        Write-Warning "Docker not running. Start Docker Desktop and try again, or use -NoDocker flag"
        $NoDocker = $true
    }
}

Write-Section "Starting Services"

# Kill any existing Node processes (optional cleanup)
$existingNode = Get-Process node -ErrorAction SilentlyContinue
if ($existingNode) {
    Write-Warning "Found existing Node processes, cleaning up..."
    $existingNode | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Start Docker services if enabled
if (-not $NoDocker) {
    Write-Info "Starting Docker Compose services (MongoDB, MinIO)..."
    Push-Location $projectRoot
    & docker-compose up -d 2>&1 | Out-Null
    Pop-Location
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker services started"
        Start-Sleep -Seconds 3
    } else {
        Write-Warning "Docker Compose startup had issues, continuing..."
    }
}

# Start Hardhat node if enabled
if (-not $NoHardhat) {
    Write-Info "Starting Hardhat local blockchain..."
    $contractsPath = "$projectRoot\contracts"
    Start-Process powershell -ArgumentList `
        "-NoExit", `
        "-WindowStyle", "Normal", `
        "-Command", "Push-Location '$contractsPath'; npm run node"
    Write-Success "Hardhat node window opening..."
    Start-Sleep -Seconds 3
}

# Start Backend
Write-Info "Starting Backend server..."
$backendPath = "$projectRoot\backend"
$backendProcess = Start-Process powershell -ArgumentList `
    "-NoExit", `
    "-WindowStyle", "Normal", `
    "-Command", "Push-Location '$backendPath'; Write-Host 'Backend starting...' -ForegroundColor Green; npm run dev" `
    -PassThru
Write-Success "Backend starting in new window (PID: $($backendProcess.Id))"
Start-Sleep -Seconds 2

# Start Frontend
Write-Info "Starting Frontend development server..."
$frontendPath = "$projectRoot\frontend"
$frontendProcess = Start-Process powershell -ArgumentList `
    "-NoExit", `
    "-WindowStyle", "Normal", `
    "-Command", "Push-Location '$frontendPath'; Write-Host 'Frontend starting...' -ForegroundColor Green; npm run dev" `
    -PassThru
Write-Success "Frontend starting in new window (PID: $($frontendProcess.Id))"

Write-Section "Services Starting"
Write-Success "All services are starting up!"
Write-Host ""
Write-Info "Please wait 5-10 seconds for services to fully initialize..."
Write-Host ""
Write-Host "Services will be available at:" @Green
Write-Host "  Frontend:    http://localhost:5173" @Cyan
Write-Host "  Backend API: http://localhost:4000" @Cyan
Write-Host "  Backend Health: http://localhost:4000/health" @Cyan
if (-not $NoHardhat) {
    Write-Host "  Hardhat RPC: http://localhost:8545" @Cyan
}
Write-Host "  MinIO (S3):  http://localhost:9000" @Cyan
Write-Host "  MinIO Console: http://localhost:9001" @Cyan
Write-Host ""
Write-Host "  MongoDB: mongodb://localhost:27017/quantumtrust" @Cyan
Write-Host ""

Write-Host "Next steps:" @Green
Write-Host "  1. Open http://localhost:5173 in your browser" @Yellow
Write-Host "  2. Check browser console (F12) for any errors" @Yellow
Write-Host "  3. Review terminal windows for startup messages" @Yellow
Write-Host ""

Write-Host "To stop all services:" @Red
Write-Host "  1. Close all the opened PowerShell windows" @Yellow
Write-Host "  2. Or run: docker-compose down" @Yellow
Write-Host ""

Write-Info "Script complete - services are starting in separate windows"

# Keep this window open showing current status
while ($true) {
    Start-Sleep -Seconds 10
    
    # Check if services are still running
    $backendRunning = Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -eq "node"}
    
    if (-not $backendRunning) {
        Write-Warning "Note: Some services may have stopped. Check their windows for errors."
    }
}
