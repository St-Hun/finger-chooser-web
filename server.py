#!/usr/bin/env python3
"""Simple LAN web server for the Finger Chooser web game."""
from __future__ import annotations

import argparse
import os
import socket
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def get_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Finger Chooser web app on your LAN.")
    parser.add_argument("--host", default="0.0.0.0", help="Host interface to bind, default: 0.0.0.0")
    parser.add_argument("--port", default=8000, type=int, help="Port, default: 8000")
    args = parser.parse_args()

    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
    handler = partial(NoCacheHandler, directory=root)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    lan_ip = get_lan_ip()

    print("Finger Chooser is running.")
    print(f"Open on this computer: http://127.0.0.1:{args.port}")
    print(f"Open on a phone on the same Wi-Fi: http://{lan_ip}:{args.port}")
    print("Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
