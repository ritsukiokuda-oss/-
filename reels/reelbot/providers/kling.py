"""Kling AI 公式API（新方式: APIキー認証・モデル名をパスに入れる）

仕様: https://kling.ai/document-api/api/video/3-0-omni/text-to-video
  POST {base}/text-to-video/{model}   Authorization: Bearer <API_KEY>
  GET  {base}/tasks?task_ids=<id>     → data[0].status / data[0].outputs[].url
"""
from pathlib import Path

import requests

from ..config import env, need
from ._http import download, poll


def _headers() -> dict:
    return {"Authorization": f"Bearer {need('KLING_API_KEY')}", "Content-Type": "application/json"}


def _ok(r: requests.Response) -> dict:
    try:
        body = r.json()
    except ValueError:
        r.raise_for_status()
        raise
    if r.status_code >= 400 or body.get("code", 0) != 0:
        raise RuntimeError(f"Kling API エラー HTTP {r.status_code} code={body.get('code')}: {body.get('message')}")
    return body["data"]


def generate(idea: dict, out: Path, seconds: int) -> Path:
    base = env("KLING_BASE_URL", "https://api-singapore.klingai.com").rstrip("/")
    model = env("KLING_MODEL", "kling-3.0")
    prompt = idea["video_prompt"]
    if idea.get("negative_prompt"):  # 新方式には negative_prompt 欄が無いので本文に含める
        prompt += f"\nAvoid: {idea['negative_prompt']}"

    body = {
        "prompt": prompt[:2500],
        "settings": {
            "resolution": env("KLING_RESOLUTION", "720p"),
            "aspect_ratio": "9:16",
            "duration": min(max(seconds, 3), 15),
            "audio": env("KLING_AUDIO", "off"),
            "multi_shot": False,  # 1カット完結の動画にする
        },
        "options": {"watermark_info": {"enabled": False}},
    }
    if model.startswith("kling-2"):  # 2.x 系は 5秒 / 10秒 のみ
        body["settings"]["duration"] = 10 if seconds > 5 else 5
        body["settings"].pop("multi_shot")

    task_id = _ok(requests.post(f"{base}/text-to-video/{model}", json=body, headers=_headers(), timeout=60))["id"]
    print(f"  Kling タスク {task_id} を作成。生成を待っています（数分かかります）…")

    def check():
        r = requests.get(f"{base}/tasks", params={"task_ids": task_id}, headers=_headers(), timeout=60)
        tasks = _ok(r)
        if not tasks:
            return None
        t = tasks[0]
        if t["status"] == "failed":
            raise RuntimeError(f"Kling 生成失敗: {t.get('message')}")
        if t["status"] == "succeeded":
            return next(o["url"] for o in t.get("outputs", []) if o.get("type") == "video")
        return None

    return download(poll(check), out)
