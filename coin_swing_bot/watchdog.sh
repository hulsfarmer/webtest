#!/bin/bash
# 코인 스윙봇 watchdog
cd /home/ubuntu/coin_swing_bot
if ! pgrep -f "python3.*coin_swing_bot/main.py" > /dev/null; then
    echo "[$(date)] 스윙봇 다운 → 재시작" >> watchdog.log
    nohup python3 -B -u main.py >> swing_bot.log 2>&1 &
fi
