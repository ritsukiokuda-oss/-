"""Runway API（text to video）"""
from pathlib import Path

import requests

from ..config import env, need
from ._http import download, poll

BASE = "https://api.dev.runwayml.com/v1"


def generate(idea: dict, out: Path, seconds: int) -> Path:
    h = {
        "Authorization": f"Bearer {need('RUNWAYML_API_SECRET')}",
        "X-Runway-Version": "2024-11-06",
        "Content-Type": "application/json",
    }
    body = {
        "model": env("RUNWAY_MODEL", "gen4.5"),
        "promptText": idea["video_prompt"][:1000],
        "ratio": "720:1280",
        "duration": 10 if seconds > 5 else 5,
    }
    r = requests.post(f"{BASE}/text_to_video", json=body, headers=h, timeout=60)
    r.raise_for_status()
    task_id = r.json()["id"]

    def check():
        d = requests.get(f"{BASE}/tasks/{task_id}", headers=h, timeout=60).json()
        if d["status"] in ("FAILED", "CANCELLED"):
            raise RuntimeError(f"Runway 生成失敗: {d.get('failure')}")
        if d["status"] == "SUCCEEDED":
            return d["output"][0]
        return None

    return download(poll(check), out)
