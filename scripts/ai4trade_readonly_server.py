from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app


class Handler(BaseHTTPRequestHandler):
    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_cors_headers()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/ai4trade/status", "/api/ai4trade/history", "/api/ai4trade/health"}:
            self.send_json({"error": "not found"}, 404)
            return
        query = urllib.parse.parse_qs(parsed.query)
        params = {key: values[0] for key, values in query.items() if values}
        try:
            if parsed.path == "/api/ai4trade/health":
                credentials = app.ai4trade_credentials_status()
                self.send_json(
                    {
                        "ok": True,
                        "mode": "local_sidecar_health",
                        "configured": bool(credentials.get("configured")),
                        "credentials": {key: value for key, value in credentials.items() if key != "_token"},
                        "policy": {
                            "mode": "read_only_signal_context",
                            "execution_allowed": False,
                            "trade_endpoints_locked": True,
                            "copy_trade_locked": True,
                            "publish_locked": True,
                            "okx_bridge": "disabled; AI4Trade can only annotate signals and market context.",
                        },
                        "history": app.read_ai4trade_history(8),
                        "updated_at": app.now_iso(),
                    }
                )
            elif parsed.path == "/api/ai4trade/history":
                try:
                    limit = int(params.get("limit") or 50)
                except ValueError:
                    limit = 50
                self.send_json(app.read_ai4trade_history(limit))
            else:
                self.send_json(app.ai4trade_status(params))
        except Exception as exc:
            self.send_json({"ok": False, "error": app.redact_sensitive_text(str(exc))}, 500)

    def log_message(self, fmt: str, *args: Any) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="AI4Trade read-only sidecar API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"AI4Trade read-only sidecar listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
