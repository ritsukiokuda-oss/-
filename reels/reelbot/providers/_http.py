import time
from pathlib import Path

import requests


def download(url: str, out: Path) -> Path:
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return out


def poll(fn, interval: int = 10, timeout: int = 900):
    """fn() が値を返すまで待つ（None なら待機続行）"""
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v is not None:
            return v
        time.sleep(interval)
    raise TimeoutError("動画生成がタイムアウトしました")
