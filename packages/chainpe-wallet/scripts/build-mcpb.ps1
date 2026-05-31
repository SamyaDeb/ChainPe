# PowerShell build script for Windows
$ErrorActionPreference = "Stop"

$ROOT_DIR = Split-Path -Parent $PSScriptRoot
$BUILD_DIR = Join-Path $ROOT_DIR ".mcpb-build"
$OUTPUT = Join-Path $ROOT_DIR "pixa.mcpb"

Write-Host "Building PIXA desktop extension..." -ForegroundColor Cyan

# 1. Clean
if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
if (Test-Path $OUTPUT) { Remove-Item -Force $OUTPUT }
New-Item -ItemType Directory -Path "$BUILD_DIR/server" -Force | Out-Null

# 2. Build TypeScript
Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
Set-Location $ROOT_DIR
& node_modules/.bin/tsup

# 3. Copy server bundle
Copy-Item "$ROOT_DIR/dist/index.js" "$BUILD_DIR/server/index.js"

# 4. Remove shebang from index.js
$content = Get-Content "$BUILD_DIR/server/index.js" -Raw
$content = $content -replace '^#!/usr/bin/env node\r?\n?', ''
Set-Content "$BUILD_DIR/server/index.js" -Value $content -NoNewline

# 5. Install production dependencies
Write-Host "Installing production dependencies..." -ForegroundColor Yellow
Copy-Item "$ROOT_DIR/package.json" "$BUILD_DIR/server/package.json"
Set-Location "$BUILD_DIR/server"
npm install --omit=dev --ignore-scripts --legacy-peer-deps
Remove-Item "package.json", "package-lock.json" -ErrorAction SilentlyContinue

# 6. Prune node_modules
Write-Host "Pruning unnecessary files..." -ForegroundColor Yellow
Remove-Item "node_modules/typescript" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path "node_modules" -Recurse -Include "*.map" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Include "*.ts" -Exclude "*.d.ts" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Include "CHANGELOG*", "HISTORY*", ".eslintrc*", ".prettierrc*", "tsconfig*.json", ".npmignore" | Remove-Item -Force
Get-ChildItem -Path "node_modules" -Recurse -Directory -Include "__tests__", "tests", "docs", "examples" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Remove CJS from ESM-first deps
if (Test-Path "node_modules/viem/_cjs") { Remove-Item "node_modules/viem/_cjs" -Recurse -Force }
if (Test-Path "node_modules/ox/_cjs") { Remove-Item "node_modules/ox/_cjs" -Recurse -Force }

# 7. Copy manifest and icon
Set-Location $BUILD_DIR
Copy-Item "$ROOT_DIR/manifest.json" "manifest.json"
if (Test-Path "$ROOT_DIR/PIXA-LOGO.PNG") {
    Copy-Item "$ROOT_DIR/PIXA-LOGO.PNG" "PIXA-LOGO.PNG"
}

# 8. Pack
Write-Host "Packing .mcpb bundle..." -ForegroundColor Yellow
$tempZip = Join-Path $ROOT_DIR "pixa.zip"
Compress-Archive -Path "$BUILD_DIR/*" -DestinationPath $tempZip -Force
Move-Item $tempZip $OUTPUT -Force

# 9. Clean up
Set-Location $ROOT_DIR
Start-Sleep -Milliseconds 500
Remove-Item -Recurse -Force $BUILD_DIR -ErrorAction SilentlyContinue

$size = (Get-Item $OUTPUT).Length / 1MB
Write-Host ""
Write-Host "Done! Created: $OUTPUT ($([math]::Round($size, 2)) MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Install in Claude Desktop:" -ForegroundColor Cyan
Write-Host "  - Double-click pixa.mcpb"
Write-Host "  - Or drag it into Claude Desktop settings"
