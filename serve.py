#!/usr/bin/env python3
"""Serve Walk On Records Video Maker so Chromebook and phone browsers can open it."""

from __future__ import annotations

import argparse
import http.server
import os
import socket
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".svg": "image/svg+xml",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("1.1.1.1", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Walk On Records Video Maker")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)
    server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    ip = lan_ip()
    print("Walk On Records Video Maker")
    print(f"  This computer:  http://127.0.0.1:{args.port}")
    print(f"  Phone / tablet: http://{ip}:{args.port}")
    print("  Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")


if __name__ == "__main__":
    main()
