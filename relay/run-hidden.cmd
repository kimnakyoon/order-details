@echo off
rem 창 없이 띄울 때 쓰는 진입점 — relay-hidden.vbs 가 이걸 숨김 실행한다.
rem 로그는 relay.log 에 덮어쓴다 (부팅마다 새로 시작하므로 무한히 커지지 않는다).
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" relay.js > relay.log 2>&1
