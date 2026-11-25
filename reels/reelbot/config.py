import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
VIDEOS = DATA / "videos"
REPORTS = DATA / "reports"
for d in (DATA, VIDEOS, REPORTS):
    d.mkdir(parents=True, exist_ok=True)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def need(name: str) -> str:
    v = env(name)
    if not v:
        raise SystemExit(f"環境変数 {name} が未設定です（.env を確認してください）")
    return v


CLAUDE_MODEL = env("CLAUDE_MODEL", "claude-opus-5-5")
FAKE_LLM = env("REELBOT_FAKE_LLM") == "1"  # APIキー無しで流れだけ試す用
VIDEO_PROVIDER = env("VIDEO_PROVIDER", "mock")
VIDEO_SECONDS = int(env("VIDEO_SECONDS", "8"))
CHECK_PASS_SCORE = int(env("CHECK_PASS_SCORE", "75"))
MAX_RETRIES = int(env("MAX_RETRIES", "2"))

# Kling 公式価格表（1ユニット=$0.14、2026-09時点）: (モデル, 音声) -> {解像度: ユニット/秒}
KLING_UNITS = {
    ("kling-3.0", "off"): {"720p": 0.6, "1080p": 0.8, "4k": 3.0},
    ("kling-3.0", "native"): {"720p": 0.9, "1080p": 1.2, "4k": 3.0},
    ("kling-3.0-turbo", "native"): {"720p": 0.8, "1080p": 1.0},
    ("kling-2.6", "off"): {"720p": 0.3, "1080p": 0.5},
    ("kling-2.5-turbo", "off"): {"720p": 0.3, "1080p": 0.5},
}


def _kling_price() -> float:
    model = env("KLING_MODEL", "kling-3.0")
    audio = "native" if model == "kling-3.0-turbo" else env("KLING_AUDIO", "off")
    units = KLING_UNITS.get((model, audio), {}).get(env("KLING_RESOLUTION", "720p"), 0.6)
    return round(units * 0.14, 4)


# 1秒あたりの目安単価（USD）。2026年11月時点の公開情報ベース。変動するので要確認。
PRICE_PER_SEC = {
    "mock": 0.0,
    "kling": _kling_price(),
    "veo": 0.10 if "fast" in env("VEO_MODEL", "fast") else 0.40,
    "runway": 0.12,
}
