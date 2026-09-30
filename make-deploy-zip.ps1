param(
    [string]$OutputPath = ".\deploy.zip"
)

$root = $PSScriptRoot

Write-Host "=== SIMAK Deploy ZIP Builder ===" -ForegroundColor Cyan

$apiDist = Join-Path $root "apps\api\dist"
$webDist = Join-Path $root "apps\web\dist"

if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::Open($OutputPath, 'Create')

function Add-FileToZip {
    param($zipArchive, $filePath, $entryName)
    $entry = $zipArchive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $writer = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $writer.Write($bytes, 0, $bytes.Length)
    $writer.Close()
}

function Add-DirToZip {
    param($zipArchive, $dirPath, $zipPrefix)
    $files = Get-ChildItem $dirPath -Recurse -File
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($dirPath.Length).TrimStart('\', '/').Replace('\', '/')
        $entryName = "$zipPrefix/$relativePath"
        Add-FileToZip -zipArchive $zipArchive -filePath $file.FullName -entryName $entryName
    }
    Write-Host "  + $zipPrefix/ ($($files.Count) files)"
}

Write-Host "Menambahkan file ke ZIP..." -ForegroundColor Yellow

$rootFiles = @(
    @{ Path = "version.json"; Entry = "version.json" },
    @{ Path = "apps\api\version.json"; Entry = "apps/api/version.json" },
    @{ Path = "package.json"; Entry = "package.json" },
    @{ Path = "pnpm-lock.yaml"; Entry = "pnpm-lock.yaml" },
    @{ Path = "apps\api\package.json"; Entry = "apps/api/package.json" },
    @{ Path = "apps\web\package.json"; Entry = "apps/web/package.json" }
)

foreach ($rf in $rootFiles) {
    $fullPath = Join-Path $root $rf.Path
    if (Test-Path $fullPath) {
        Add-FileToZip -zipArchive $zip -filePath $fullPath -entryName $rf.Entry
        Write-Host "  + $($rf.Entry)"
    }
}

Add-DirToZip -zipArchive $zip -dirPath "$apiDist\" -zipPrefix "apps/api/dist"
Add-DirToZip -zipArchive $zip -dirPath "$webDist\" -zipPrefix "apps/web/dist"

$webPublicVersion = Join-Path $root "apps\web\public\version.json"
if (Test-Path $webPublicVersion) {
    Add-FileToZip -zipArchive $zip -filePath $webPublicVersion -entryName "apps/web/public/version.json"
    Write-Host "  + apps/web/public/version.json"
}

$zip.Dispose()

$zipInfo = Get-Item $OutputPath
$sizeMB = [Math]::Round($zipInfo.Length / 1MB, 2)
Write-Host "`n=== Selesai! ===" -ForegroundColor Green
Write-Host "ZIP siap di: $OutputPath ($sizeMB MB)"
