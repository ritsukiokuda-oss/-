"""分析担当: 投稿の数字を集めて、勝ちパターンをネタ担当に返す"""
import json
from datetime import datetime

from pydantic import BaseModel, Field

from . import instagram, store
from .config import FAKE_LLM, REPORTS
from .llm import ask

SYSTEM = """あなたはInstagramリールのデータ分析担当です。
投稿ごとのネタ内容と数字（再生数・リーチ・保存・シェア・平均視聴時間など）を比べ、
何が伸びて何が伸びなかったかを、次のネタ出しにそのまま使える形でまとめます。
重視する指標: 平均視聴時間と最後まで見られたか（つかみと完走）、シェアと保存（拡散力）、再生数。
投稿数が少ないうちは断定せず「仮説」として書いてください。"""


class Analysis(BaseModel):
    report_markdown: str = Field(description="人が読むための分析レポート（日本語Markdown、表を含む）")
    learnings: list[str] = Field(description="ネタ担当に渡す具体的な学び（例: 『犬より猫の方がシェア率2倍』）")
    next_themes: list[str] = Field(description="次に試すべきテーマ案")


def collect() -> list[dict]:
    rows = []
    for it in store.by_status("published"):
        stats = instagram.insights(it["media_id"])
        store.update(it, None, stats=stats, stats_at=store.now())
        rows.append({"id": it["id"], "title": it["idea"]["title"], "animal": it["idea"]["animal"],
                     "situation": it["idea"]["situation"], "overlay": it["idea"]["overlay_text"],
                     "check_score": it.get("review", {}).get("score"), "cost_usd": it.get("cost_usd"),
                     **stats})
    return rows


def analyze() -> str:
    rows = collect()
    if not rows:
        return "投稿済みの動画がまだありません。"
    if FAKE_LLM:
        a = Analysis(report_markdown="# サンプルレポート", learnings=["サンプル"], next_themes=[])
    else:
        a = ask(SYSTEM, "投稿データ:\n" + json.dumps(rows, ensure_ascii=False, indent=1), Analysis, effort="high")

    path = REPORTS / f"report_{datetime.now():%Y%m%d_%H%M}.md"
    path.write_text(a.report_markdown, encoding="utf-8")
    store.LEARNINGS.write_text(
        f"# 分析担当からの学び（{datetime.now():%Y-%m-%d}更新）\n"
        + "\n".join(f"- {x}" for x in a.learnings)
        + "\n\n## 次に試すテーマ\n" + "\n".join(f"- {x}" for x in a.next_themes) + "\n",
        encoding="utf-8",
    )
    return str(path)
