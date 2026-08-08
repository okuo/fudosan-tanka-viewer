# Create distribution zip file for Chrome Web Store

Write-Host "Creating distribution zip..." -ForegroundColor Green

# Remove dist folder if exists
if (Test-Path "dist") {
    Remove-Item -Recurse -Force dist
}

# Create dist folder
New-Item -ItemType Directory -Path "dist" | Out-Null

# Copy required files
Write-Host "Copying files..." -ForegroundColor Yellow
Copy-Item "manifest.json" "dist/"
Copy-Item "property-matcher.js" "dist/"
Copy-Item "observed-listings-store.js" "dist/"
Copy-Item "background.js" "dist/"
Copy-Item "content.js" "dist/"
Copy-Item "styles.css" "dist/"
Copy-Item "popup.html" "dist/"
Copy-Item "popup.js" "dist/"
Copy-Item "popup.css" "dist/"
Copy-Item "sidepanel.html" "dist/"
Copy-Item "sidepanel.js" "dist/"
Copy-Item "sidepanel.css" "dist/"
Copy-Item -Recurse "icons" "dist/"

# Remove old zip if exists
if (Test-Path "fudosan-tanka-viewer.zip") {
    Remove-Item "fudosan-tanka-viewer.zip"
}

# Create zip file
Write-Host "Creating zip..." -ForegroundColor Yellow
Compress-Archive -Path "dist\*" -DestinationPath "fudosan-tanka-viewer.zip" -Force

# Remove dist folder
Remove-Item -Recurse -Force dist

Write-Host "Done! fudosan-tanka-viewer.zip created." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Visit Chrome Web Store Developer Dashboard" -ForegroundColor White
Write-Host "   https://chrome.google.com/webstore/devconsole" -ForegroundColor Gray
Write-Host "2. Add new item" -ForegroundColor White
Write-Host "3. Upload fudosan-tanka-viewer.zip" -ForegroundColor White
Write-Host "4. Follow BUILD_GUIDE.md for details" -ForegroundColor White
Write-Host ""
