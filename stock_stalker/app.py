#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(BASE_DIR, "stock_stalker.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            type TEXT NOT NULL,
            threshold REAL NOT NULL,
            window_minutes INTEGER DEFAULT 60,
            enabled INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def fetch_quote(symbol: str):
    safe = ''.join(ch for ch in symbol.upper().strip() if ch.isalnum() or ch in '.-')
    if not safe:
        raise ValueError("Invalid symbol")

    url = f"https://stooq.com/q/l/?s={urllib.parse.quote(safe.lower())}&f=sd2t2ohlcv&h&e=csv"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "StockStalker/1.0"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip().splitlines()

    if len(raw) < 2:
        raise ValueError("Quote unavailable")

    headers = [h.strip().lower() for h in raw[0].split(',')]
    values = [v.strip() for v in raw[1].split(',')]
    row = dict(zip(headers, values))

    if row.get("close", "N/D") in ("N/D", "", None):
        raise ValueError("Symbol not found or delayed data unavailable")

    return {
        "symbol": row.get("symbol", safe.upper()),
        "date": row.get("date", ""),
        "time": row.get("time", ""),
        "open": float(row.get("open", "0") or 0),
        "high": float(row.get("high", "0") or 0),
        "low": float(row.get("low", "0") or 0),
        "close": float(row.get("close", "0") or 0),
        "volume": int(float(row.get("volume", "0") or 0)),
        "source": "stooq",
        "fetched_at": utc_now_iso(),
    }


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/quote":
            q = urllib.parse.parse_qs(parsed.query)
            symbol = (q.get("symbol") or [""])[0]
            try:
                quote = fetch_quote(symbol)
                return self._json({"ok": True, "quote": quote})
            except Exception as exc:
                return self._json({"ok": False, "error": str(exc)}, status=400)

        if parsed.path == "/api/watchlist":
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("SELECT id, symbol, note, created_at FROM watchlist ORDER BY symbol")
            rows = [
                {"id": r[0], "symbol": r[1], "note": r[2], "created_at": r[3]}
                for r in cur.fetchall()
            ]
            conn.close()
            return self._json({"ok": True, "watchlist": rows})

        if parsed.path == "/api/alerts":
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute(
                "SELECT id, symbol, type, threshold, window_minutes, enabled, created_at FROM alerts ORDER BY id DESC"
            )
            rows = [
                {
                    "id": r[0],
                    "symbol": r[1],
                    "type": r[2],
                    "threshold": r[3],
                    "window_minutes": r[4],
                    "enabled": bool(r[5]),
                    "created_at": r[6],
                }
                for r in cur.fetchall()
            ]
            conn.close()
            return self._json({"ok": True, "alerts": rows})

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            data = {}

        if parsed.path == "/api/watchlist":
            symbol = str(data.get("symbol", "")).upper().strip()
            note = str(data.get("note", "")).strip()
            if not symbol:
                return self._json({"ok": False, "error": "symbol is required"}, status=400)
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            try:
                cur.execute(
                    "INSERT INTO watchlist(symbol, note, created_at) VALUES(?,?,?)",
                    (symbol, note, utc_now_iso()),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                return self._json({"ok": False, "error": "symbol already exists"}, status=409)
            conn.close()
            return self._json({"ok": True})

        if parsed.path == "/api/alerts":
            symbol = str(data.get("symbol", "")).upper().strip()
            atype = str(data.get("type", "")).strip()
            threshold = data.get("threshold")
            window = int(data.get("window_minutes", 60) or 60)
            valid = {"below_price", "above_price", "percent_drop", "percent_rise"}
            if not symbol or atype not in valid:
                return self._json({"ok": False, "error": "invalid alert payload"}, status=400)
            try:
                threshold = float(threshold)
            except Exception:
                return self._json({"ok": False, "error": "threshold must be numeric"}, status=400)
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO alerts(symbol, type, threshold, window_minutes, enabled, created_at) VALUES(?,?,?,?,?,?)",
                (symbol, atype, threshold, window, 1, utc_now_iso()),
            )
            conn.commit()
            conn.close()
            return self._json({"ok": True})

        return self._json({"ok": False, "error": "Not found"}, status=404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/watchlist/"):
            item_id = parsed.path.rsplit("/", 1)[-1]
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("DELETE FROM watchlist WHERE id=?", (item_id,))
            conn.commit()
            conn.close()
            return self._json({"ok": True})

        if parsed.path.startswith("/api/alerts/"):
            item_id = parsed.path.rsplit("/", 1)[-1]
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            cur.execute("DELETE FROM alerts WHERE id=?", (item_id,))
            conn.commit()
            conn.close()
            return self._json({"ok": True})

        return self._json({"ok": False, "error": "Not found"}, status=404)


def main():
    parser = argparse.ArgumentParser(description="Stock Stalker server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    init_db()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Stock Stalker running on http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
