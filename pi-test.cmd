@echo off
node "%~dp0scripts\pi-test.mjs" %*
exit /b %errorlevel%
