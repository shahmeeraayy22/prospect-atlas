@echo off
setlocal
title Stop Prospect Atlas
docker stop codex-google-maps-scraper >nul 2>nul
if errorlevel 1 (
  echo Prospect Atlas was not running.
) else (
  echo Prospect Atlas has stopped. Your saved searches are preserved.
)
timeout /t 2 /nobreak >nul
endlocal
