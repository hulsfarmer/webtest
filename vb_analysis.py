#!/usr/bin/env python3
"""VB봇 거래 분석"""
import sqlite3
from collections import defaultdict

conn = sqlite3.connect('/home/ubuntu/coin_vb_bot/vb_bot.db')
conn.row_factory = sqlite3.Row

rows = conn.execute('SELECT * FROM trades ORDER BY id').fetchall()
if not rows:
    print("거래 없음")
    exit()

wins = [r for r in rows if r['pnl'] > 0]
losses = [r for r in rows if r['pnl'] <= 0]
total_pnl = sum(r['pnl'] for r in rows)
avg_pct = sum(r['pnl_pct'] for r in rows) / len(rows) * 100

print(f"=== 전체: {len(rows)}건 ===")
print(f"승: {len(wins)} | 패: {len(losses)} | 승률: {len(wins)/len(rows)*100:.1f}%")
print(f"총PnL: {total_pnl:+,.0f}원 | 평균: {avg_pct:+.2f}%")
if wins:
    avg_win = sum(r['pnl_pct'] for r in wins) / len(wins) * 100
    print(f"평균 수익: +{avg_win:.2f}%")
if losses:
    avg_loss = sum(r['pnl_pct'] for r in losses) / len(losses) * 100
    print(f"평균 손실: {avg_loss:.2f}%")

print()
print("=== 종목별 ===")
by_market = defaultdict(list)
for r in rows:
    by_market[r['market']].append(r)
for m, trades in sorted(by_market.items(), key=lambda x: sum(t['pnl'] for t in x[1])):
    w = sum(1 for t in trades if t['pnl'] > 0)
    pnl = sum(t['pnl'] for t in trades)
    avg = sum(t['pnl_pct'] for t in trades) / len(trades) * 100
    nm = m.replace('KRW-', '')
    print(f"  {nm:5s} | {len(trades):2d}건 | 승 {w} 패 {len(trades)-w} | 평균 {avg:+.2f}% | PnL {pnl:+,.0f}")

print()
print("=== reason별 ===")
by_reason = defaultdict(list)
for r in rows:
    by_reason[r['reason']].append(r)
for reason, trades in by_reason.items():
    w = sum(1 for t in trades if t['pnl'] > 0)
    pnl = sum(t['pnl'] for t in trades)
    avg = sum(t['pnl_pct'] for t in trades) / len(trades) * 100
    print(f"  {reason:8s} | {len(trades):2d}건 | 승 {w} 패 {len(trades)-w} | 평균 {avg:+.2f}% | PnL {pnl:+,.0f}")

print()
print("=== 시간대별 (진입 시간) ===")
by_hour = defaultdict(list)
for r in rows:
    try:
        hour = r['entry_time'][11:13]
        by_hour[hour].append(r)
    except:
        pass
for h in sorted(by_hour.keys()):
    trades = by_hour[h]
    w = sum(1 for t in trades if t['pnl'] > 0)
    pnl = sum(t['pnl'] for t in trades)
    avg = sum(t['pnl_pct'] for t in trades) / len(trades) * 100
    print(f"  {h}시 | {len(trades):2d}건 | 승 {w} 패 {len(trades)-w} | 평균 {avg:+.2f}% | PnL {pnl:+,.0f}")

print()
print("=== 보유 시간 분석 ===")
from datetime import datetime
hold_times = []
for r in rows:
    try:
        entry = datetime.fromisoformat(r['entry_time'])
        exit_ = datetime.fromisoformat(r['exit_time'])
        hold_h = (exit_ - entry).total_seconds() / 3600
        hold_times.append((hold_h, r['pnl_pct'] * 100, r['reason'], r['market']))
    except:
        pass

if hold_times:
    avg_hold = sum(h[0] for h in hold_times) / len(hold_times)
    print(f"  평균 보유시간: {avg_hold:.1f}시간")
    win_hold = [h[0] for h in hold_times if h[1] > 0]
    loss_hold = [h[0] for h in hold_times if h[1] <= 0]
    if win_hold:
        print(f"  수익 평균: {sum(win_hold)/len(win_hold):.1f}시간")
    if loss_hold:
        print(f"  손실 평균: {sum(loss_hold)/len(loss_hold):.1f}시간")

print()
print("=== 전체 거래 내역 ===")
for r in rows:
    nm = r['market'].replace('KRW-', '')
    pct = r['pnl_pct'] * 100
    emoji = "O" if r['pnl'] > 0 else "X"
    print(f"  {emoji} {r['entry_time'][:16]} {nm:5s} {r['entry_price']:>12,.0f} -> {r['exit_price']:>12,.0f} | {pct:+.2f}% | {r['pnl']:+,.0f} | {r['reason']}")

# 현재 포지션
print()
print("=== 현재 포지션 ===")
pos = conn.execute("SELECT * FROM positions WHERE status='open'").fetchall()
if pos:
    for p in pos:
        nm = p['market'].replace('KRW-', '')
        print(f"  {nm} | 진입 {p['entry_price']:,.0f} | 타겟 {p['target_price']:,.0f} | {p['entry_time'][:16]}")
else:
    print("  없음")

# bot_state
print()
print("=== 봇 상태 ===")
states = conn.execute("SELECT * FROM bot_state").fetchall()
for s in states:
    print(f"  {s['key']}: {s['value']}")

conn.close()
