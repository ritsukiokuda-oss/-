"""Google Veo（Gemini API, google-genai SDK）。音声付きで生成される。"""
import time
from pathlib import Path

from ..config import env, need


def generate(idea: dict, out: Path, seconds: int) -> Path:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=need("GEMINI_API_KEY"))
    op = client.models.generate_videos(
        model=env("VEO_MODEL", "veo-3.1-fast-generate-preview"),
        prompt=idea["video_prompt"],
        config=types.GenerateVideosConfig(
            aspect_ratio="9:16",
            negative_prompt=idea.get("negative_prompt") or None,
            duration_seconds=min(max(seconds, 4), 8),
        ),
    )
    end = time.time() + 900
    while not op.done:
        if time.time() > end:
            raise TimeoutError("Veo 生成がタイムアウトしました")
        time.sleep(10)
        op = client.operations.get(op)
    if not op.response or not op.response.generated_videos:
        raise RuntimeError(f"Veo 生成失敗: {op.error}")
    video = op.response.generated_videos[0]
    client.files.download(file=video.video)
    video.video.save(str(out))
    return out
