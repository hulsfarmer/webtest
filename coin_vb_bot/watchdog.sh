#!/bin/bash
# 변동성 돌파봇 watchdog
cd /home/ubuntu/coin_vb_bot
if ! pgrep -f "python3.*coin_vb_bot/main.py" > /dev/null; then
    echo "$(date) VB bot down, restarting..." >> /home/ubuntu/coin_vb_bot/watchdog.log
    nohup python3 -B -u main.py >> vb_bot.log 2>&1 &
fi
