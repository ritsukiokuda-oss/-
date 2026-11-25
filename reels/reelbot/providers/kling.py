"""Kling AI（公式API）。認証は AccessKey/SecretKey から作る JWT。"""
import time
from pathlib import Path

import jwt
import requests

from ..config import env, need
from ._http import download, poll


def _token() -> str:
    now = int(time.time())
    payload = {"iss": need("KLING_ACCESS_KEY"), "exp": now + 1800, "nbf": now - 5}
    return jwt.encode(payload, need("KLING_SECRET_KEY"), algorithm="HS256", headers={"typ": "JWT"})


def generate(idea: dict, out: Path, seconds: int) -> Path:
    base = env("KLING_BASE_URL", "https://api-singapore.klingai.com")
    h = lambda: {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    body = {
        "model_name": env("KLING_MODEL", "kling-v2-6"),
        "prompt": idea["video_prompt"],
        "negative_prompt": idea.get("negative_prompt", ""),
        "mode": env("KLING_MODE", "std"),
        "aspect_ratio": "9:16",
        "duration": "10" if seconds > 5 else "5",
    }
    r = requests.post(f"{base}/v1/videos/text2video", json=body, headers=h(), timeout=60)
    r.raise_for_status()
    task_id = r.json()["data"]["task_id"]

    def check():
        d = requests.get(f"{base}/v1/videos/text2video/{task_id}", headers=h(), timeout=60).json()["data"]
        if d["task_status"] == "failed":
            raise RuntimeError(f"Kling 生成失敗: {d.get('task_status_msg')}")
        if d["task_status"] == "succeed":
            return d["task_result"]["videos"][0]["url"]
        return None

    return download(poll(check), out)
