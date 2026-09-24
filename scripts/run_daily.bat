@echo off
REM Windows Task Scheduler: run this at 7:30 on weekdays. Set the CF_PW_* variables as user
REM environment variables first (System Properties > Environment Variables).
cd /d %~dp0\..
python -m coldflow daily --live >> logs\daily.log 2>&1
