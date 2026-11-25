"""Claude 呼び出し（構造化出力）。ネタ・チェック・分析担当が共通で使う。"""
import base64
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from .config import CLAUDE_MODEL

T = TypeVar("T", bound=BaseModel)
_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def ask(system: str, prompt: str, schema: type[T], images: list[Path] = (), effort: str = "medium") -> T:
    content = []
    for p in images:
        data = base64.standard_b64encode(Path(p).read_bytes()).decode()
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}})
    content.append({"type": "text", "text": prompt})

    resp = _get_client().beta.messages.parse(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": content}],
        output_format=schema,
        output_config={"effort": effort},
        # 安全フィルタで断られた場合に別モデルで自動再実行
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError(f"Claude が応答を拒否しました: {resp.stop_details}")
    if resp.parsed_output is None:
        raise RuntimeError(f"出力を解析できませんでした (stop_reason={resp.stop_reason})")
    return resp.parsed_output
