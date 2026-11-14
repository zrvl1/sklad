@echo off
rem Start the warehouse app. Put a shortcut to this file into Windows Startup.
title Sklad
cd /d %~dp0
call npm start
pause
