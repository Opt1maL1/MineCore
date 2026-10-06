@echo off
chcp 65001 > nul
title OhioWorld - Интерактивная карта мира
echo ========================================================
echo       OhioWorld - Локальный веб-сервер карты
echo ========================================================
echo.
echo Открытие карты в браузере...
start http://localhost:8000/index.html
echo.
echo Сервер запущен на http://localhost:8000/
echo Для остановки сервера закройте это окно (или нажмите Ctrl+C).
echo.
python -m http.server 8000
pause
