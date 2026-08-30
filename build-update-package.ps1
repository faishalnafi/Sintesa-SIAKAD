# =====================================================
# SINTESA - Script Pembuatan Paket Update (.ZIP)
# =====================================================
# Jalankan dari root direktori sintesa:
# PowerShell: .\build-update-package.ps1
# =====================================================

param(
    [string]$OutputDir = ".\update-packages"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  SINTESA - Build Update Package" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Baca version.json
$VersionJsonPath = Join-Path $Root "version.json"
if (-not (Test-Path $VersionJsonPath)) {
    Write-Host "[ERROR] version.json tidak ditemukan di root proyek!" -ForegroundColor Red
    exit 1
}

$manifest = Get-Content $VersionJsonPath | ConvertFrom-Json
$version = $manifest.version
$versionCode = $manifest.version_code

Write-Host "[INFO] Membangun paket update untuk versi: v$version (build #$versionCode)" -ForegroundColor Yellow
Write-Host ""

# Step 2: Build Web Frontend
Write-Host "[1/3] Membangun frontend (apps/web)..." -ForegroundColor Green
Set-Location (Join-Path $Root "apps\web")
& pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build web gagal!" -ForegroundColor Red
    Set-Location $Root
    exit 1
}
Set-Location $Root
Write-Host "      Frontend berhasil dibangun." -ForegroundColor Green

# Step 3: Build API Backend
Write-Host "[2/3] Membangun backend API (apps/api)..." -ForegroundColor Green
Set-Location (Join-Path $Root "apps\api")
& pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build API gagal!" -ForegroundColor Red
    Set-Location $Root
    exit 1
}
Set-Location $Root
Write-Host "      Backend berhasil dibangun." -ForegroundColor Green

# Step 4: Buat paket ZIP
Write-Host "[3/3] Membuat paket ZIP update..." -ForegroundColor Green

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$dateStr = Get-Date -Format "yyyyMMdd-HHmm"
$zipName = "sintesa-update-v${version}-${dateStr}.zip"
$zipPath = Join-Path (Join-Path $Root $OutputDir) $zipName

# Gunakan .NET ZipFile
Add-Type -AssemblyName System.IO.Compression.FileSystem

$tempDir = Join-Path $env:TEMP "sintesa-pkg-$version"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Salin version.json ke root
Copy-Item $VersionJsonPath (Join-Path $tempDir "version.json")

# Salin apps/web/dist
$webDistSrc = Join-Path $Root "apps\web\dist"
$webDistDst = Join-Path $tempDir "apps\web\dist"
New-Item -ItemType Directory -Path $webDistDst -Force | Out-Null
Copy-Item "$webDistSrc\*" $webDistDst -Recurse

# Salin apps/api/dist
$apiDistSrc = Join-Path $Root "apps\api\dist"
$apiDistDst = Join-Path $tempDir "apps\api\dist"
New-Item -ItemType Directory -Path $apiDistDst -Force | Out-Null
Copy-Item "$apiDistSrc\*" $apiDistDst -Recurse

# Salin apps/web/public (version.json untuk frontend public)
$webPublicSrc = Join-Path $Root "apps\web\public"
$webPublicDst = Join-Path $tempDir "apps\web\public"
if (Test-Path $webPublicSrc) {
    New-Item -ItemType Directory -Path $webPublicDst -Force | Out-Null
    Copy-Item "$webPublicSrc\version.json" $webPublicDst -ErrorAction SilentlyContinue
}

# Buat ZIP
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory($tempDir, $zipPath)

# Bersihkan temp
Remove-Item $tempDir -Recurse -Force

$zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Paket Update Berhasil Dibuat!" -ForegroundColor Green  
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  File   : $zipName" -ForegroundColor White
Write-Host "  Ukuran : $zipSizeMB MB" -ForegroundColor White
Write-Host "  Path   : $zipPath" -ForegroundColor White
Write-Host ""
Write-Host "  Upload file ZIP ini melalui halaman Admin > Update & Backup" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
