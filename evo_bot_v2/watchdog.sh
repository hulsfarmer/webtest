#!/bin/bash
# evo-bot watchdog — cron으로 5분마다 실행
# crontab: */5 * * * * /home/ubuntu/kis_trader/evo_bot/watchdog.sh

if ! pgrep -f 'python3.*evo_bot/main.py' > /dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] evo-bot 재시작" >> /home/ubuntu/kis_trader/evo_bot/watchdog.log
    cd /home/ubuntu/kis_trader/evo_bot
    nohup python3 -B -u main.py >> evo_bot.log 2>&1 &
fi
