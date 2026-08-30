@echo off
rem 브라우저 사이 다리 — 이 창을 닫으면 멈춥니다. 켜 둔 채로 두세요.
title mango relay
cd /d "%~dp0"

rem node 를 PATH 에서 찾고, 없으면 기본 설치 위치로 떨어진다.
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%ProgramFiles%\nodejs\node.exe" if "%NODE%" neq "node" (
  echo.
  echo   node 를 찾지 못했습니다. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

"%NODE%" relay.js

echo.
echo   릴레이가 멈췄습니다. 위 메시지를 확인하세요.
pause
