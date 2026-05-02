# Stock Stalker

Stock Stalker is a lightweight mobile-friendly stock monitoring web app designed to run well in Termux (Android) with minimal dependencies.

## Features
- Track multiple stock symbols.
- Set alert rules:
  - Price drops below a target (buy-the-dip style)
  - Price rises above a target
  - Percent move in a window (up/down)
- Browser notifications when rules trigger.
- Local persistence with SQLite (watchlist/rules) and local browser state.
- Mobile-first UI and one-tap navigation.
- Shareable: copy the project folder and run with Python.

## Quick Start (Termux)
```bash
pkg update -y
pkg install -y python
cd ~/operator-system
python3 stock_stalker/app.py
```

Open in your phone browser:
- `http://127.0.0.1:8787`

If you want other devices on your Wi-Fi to access it:
```bash
python3 stock_stalker/app.py --host 0.0.0.0 --port 8787
```
Then open `http://YOUR_PHONE_IP:8787` from other devices.

## Project Structure
- `stock_stalker/app.py` - lightweight HTTP server + stock quote API proxy + SQLite storage
- `stock_stalker/static/index.html` - mobile UI
- `stock_stalker/static/app.js` - app logic, polling, notifications, alert engine
- `stock_stalker/static/style.css` - responsive styles

## Notes
- Quote data uses the Stooq public endpoint and may be delayed.
- This is an alerting utility, not financial advice.
