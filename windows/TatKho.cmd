@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\Stop-Kho.ps1"
if errorlevel 1 pause
