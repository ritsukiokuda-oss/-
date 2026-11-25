"""動画生成サービスの切り替え口。どれも generate(idea, out_path, seconds) -> Path を持つ。"""
from importlib import import_module

from ..config import VIDEO_PROVIDER


def get(name: str | None = None):
    name = name or VIDEO_PROVIDER
    if name not in ("mock", "kling", "veo", "runway"):
        raise SystemExit(f"VIDEO_PROVIDER={name} は未対応です（mock / kling / veo / runway）")
    return import_module(f".{name}", __name__)
