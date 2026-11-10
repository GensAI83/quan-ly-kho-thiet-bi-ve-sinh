@echo off
chcp 65001 >nul
rem Chay app Quan ly kho thiet bi ve sinh truc tiep tren may tinh (Bun + SQLite).
rem Chi can dup file nay. Du lieu luu trong standalone\data\warehouse.db
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo Chua cai Bun. Dang mo huong dan cai dat...
  echo Hay chay lenh sau trong PowerShell roi mo lai terminal:
  echo powershell -c "irm bun.sh/install.ps1 | iex"
  echo Sau khi cai xong, dong/mo lai terminal roi dup lai start.bat.
  pause
  exit /b 1
)

rem Cho phep server tim thay shim SDK va cac goi trong standalone\node_modules
rem (actions.ts nam ngoai standalone/ nen Bun khong tu tim thay).
set NODE_PATH=%~dp0node_modules

if not exist "%~dp0dist\app.js" (
  echo Chua co ban build (dist\app.js). Dang build client...
  call bun run build
  if errorlevel 1 (
    echo Build that bai. Hay mo terminal tai thu muc standalone va chay: bun run build
    pause
    exit /b 1
  )
)

echo Dang khoi dong server tai http://127.0.0.1:3000 ...
start "" http://127.0.0.1:3000
call bun run start
pause
