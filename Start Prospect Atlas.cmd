@echo off
setlocal
title Prospect Atlas
set "APP_DIR=%~dp0"
set "DATA_DIR=%APP_DIR%gmapsdata"
set "DOCKER_APP=C:\Program Files\Docker\Docker\Docker Desktop.exe"

where docker >nul 2>nul || (
  echo Docker Desktop is not installed or is not available in PATH.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Starting Docker Desktop...
  if not exist "%DOCKER_APP%" (
    echo Docker Desktop could not be found.
    pause
    exit /b 1
  )
  start "" "%DOCKER_APP%"
  for /l %%I in (1,1,40) do (
    docker info >nul 2>nul && goto docker_ready
    timeout /t 3 /nobreak >nul
  )
  echo Docker did not become ready. Open Docker Desktop and try again.
  pause
  exit /b 1
)

:docker_ready
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
docker image inspect maps-lead-studio:local >nul 2>nul || (
  echo Preparing the local dashboard for the first time...
  docker build -t maps-lead-studio:local "%APP_DIR%."
  if errorlevel 1 (
    echo The dashboard build failed.
    pause
    exit /b 1
  )
)

docker inspect codex-google-maps-scraper >nul 2>nul
if errorlevel 1 (
  docker run -d --name codex-google-maps-scraper -v "%DATA_DIR%:/gmapsdata" -p 8080:8080 maps-lead-studio:local -data-folder /gmapsdata >nul
) else (
  docker start codex-google-maps-scraper >nul
)

timeout /t 2 /nobreak >nul
start "" "http://localhost:8080"
echo Prospect Atlas is running at http://localhost:8080
timeout /t 2 /nobreak >nul
endlocal
