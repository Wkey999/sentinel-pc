@echo off
powershell -NoProfile -File "%~dp0scripts\preview.ps1" -OpenBrowser
if errorlevel 1 pause
