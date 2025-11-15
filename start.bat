@echo off
cd /d %~dp0
pm2 start index.js --name Sora
pauses