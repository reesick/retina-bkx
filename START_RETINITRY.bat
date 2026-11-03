@echo off
REM Double-click to start Retinitry. First run installs the Python packages and rebuilds the model files.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 pause
