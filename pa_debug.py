#!/usr/bin/env python3
"""Print PA imaging diagnostics from the Butterfly server."""

import argparse
import json
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def request_json(method, url, body=None, timeout=3.0):
    payload = None
    headers = {}
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=payload, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def build_url(base_url, path):
    return base_url.rstrip("/") + path


def print_json(title, payload):
    print(f"\n{title}")
    print(json.dumps(payload, indent=2, sort_keys=True))


def tcp_probe(host, port, timeout):
    started = time.time()
    with socket.create_connection((host, int(port)), timeout=timeout):
        return time.time() - started


def main():
    parser = argparse.ArgumentParser(description="Query PA imaging diagnostics")
    parser.add_argument("--backend", default="http://192.168.8.236:8080", help="Butterfly server base URL")
    parser.add_argument("--timeout", type=float, default=3.0, help="HTTP/TCP timeout seconds")
    parser.add_argument("--tcp-host", default="", help="Override PA TCP host for --tcp-probe")
    parser.add_argument("--tcp-port", type=int, default=9090, help="PA TCP port for --tcp-probe")
    parser.add_argument(
        "--tcp-probe",
        action="store_true",
        help="Connect to the PA TCP listener once, then call /api/pa/disconnect to clear the probe socket",
    )
    args = parser.parse_args()

    try:
        diagnostics = request_json("GET", build_url(args.backend, "/api/pa/diagnostics"), timeout=args.timeout)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        print(f"PA diagnostics request failed: {exc}", file=sys.stderr)
        return 2

    print_json("PA diagnostics", diagnostics)

    if args.tcp_probe:
        backend_host = urlparse(args.backend).hostname or "127.0.0.1"
        tcp_host = args.tcp_host.strip() or backend_host
        try:
            elapsed = tcp_probe(tcp_host, args.tcp_port, args.timeout)
        except OSError as exc:
            print(f"\nPA TCP probe failed: {tcp_host}:{args.tcp_port} {exc}", file=sys.stderr)
            return 3
        print(f"\nPA TCP probe ok: {tcp_host}:{args.tcp_port} in {elapsed * 1000.0:.1f} ms")
        try:
            cleanup = request_json(
                "POST",
                build_url(args.backend, "/api/pa/disconnect"),
                body={"join_timeout_s": 0},
                timeout=args.timeout,
            )
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"PA TCP probe cleanup failed: {exc}", file=sys.stderr)
            return 4
        print_json("PA cleanup", cleanup)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
