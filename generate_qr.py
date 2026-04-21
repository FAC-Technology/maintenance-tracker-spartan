#!/usr/bin/env python3
"""Generate a QR code PNG pointing to the maintenance tracker URL.

Usage:
    python generate_qr.py [IP_ADDRESS]

If no IP is given, it tries to auto-detect the device's LAN IP.
Saves qr_code.png in the current directory.
"""

import socket
import sys

import qrcode


def get_lan_ip() -> str:
    """Best-effort LAN IP detection."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def main():
    if len(sys.argv) > 1:
        ip = sys.argv[1]
    else:
        ip = get_lan_ip()

    url = f"http://{ip}:5001"
    print(f"Generating QR code for: {url}")

    img = qrcode.make(url, box_size=10, border=4)
    out = "qr_code.png"
    img.save(out)
    print(f"Saved to {out}")


if __name__ == "__main__":
    main()
