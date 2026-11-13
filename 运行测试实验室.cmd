@echo off
chcp 65001 >nul
powershell.exe -NoProfile -File "%~dp0scripts\test-lab.ps1" -Live
echo.
echo 测试结束。报告路径已显示在上方；发现失败项时请查看 TEST_REPORT.md。
pause
