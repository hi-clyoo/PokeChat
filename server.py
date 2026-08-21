#!/usr/bin/env python3
"""PokeChat 极简后端（零依赖：仅 Python 标准库，无需 pip install）。

用法：python3 server.py [port]    # 默认 8123
接口：
  POST /api/feedback            {items:[{path,selector,text,note}]} → 落盘
  GET  /api/feedback/status     {pending,processing,done}（含 conclusion 回复）
  GET  /                        Demo 页（静态文件）
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
os.makedirs(DATA, exist_ok=True)


def _status():
    out = {"pending": [], "processing": [], "done": []}
    for sub in ("", "processing", "done"):
        d = os.path.join(DATA, sub) if sub else DATA
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, f), encoding="utf-8") as fh:
                    out[sub or "pending"].append(json.load(fh))
            except Exception:
                pass
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/feedback/status":
            self._send(200, _status())
            return
        if path in ("/", "/index.html"):
            self._serve_file("index.html", "text/html; charset=utf-8")
            return
        if path == "/pokechat.js":
            self._serve_file("pokechat.js", "text/javascript; charset=utf-8")
            return
        self._send(404, {"error": "not found"})

    def _serve_file(self, name, ctype):
        p = os.path.join(HERE, name)
        if not os.path.isfile(p):
            self._send(404, {"error": "missing " + name})
            return
        with open(p, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urlparse(self.path).path != "/api/feedback":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception as e:
            self._send(400, {"error": str(e)})
            return
        saved = []
        for it in body.get("items", []):
            ts = time.strftime("%Y%m%d-%H%M%S")
            path = os.path.join(DATA, f"{ts}.json")
            i = 1
            while os.path.exists(path):
                i += 1
                path = os.path.join(DATA, f"{ts}-{i}.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"ts": os.path.basename(path)[:-5],
                           "path": it.get("path", ""), "selector": it.get("selector", ""),
                           "text": it.get("text", ""), "note": it.get("note", "")},
                          fh, ensure_ascii=False)
            saved.append(os.path.basename(path)[:-5])
        self._send(200, {"ok": True, "count": len(saved)})


if __name__ == "__main__":
    port = 8123
    print(f"PokeChat server: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
