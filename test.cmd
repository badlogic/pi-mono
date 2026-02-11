@echo off
node "%~dp0scripts\test-no-env.mjs" %*
exit /b %errorlevel%
