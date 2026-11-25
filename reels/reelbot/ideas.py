"""ネタ担当: 過去の分析結果を踏まえて、動物が人間っぽく動くリールのネタを考える"""
from pydantic import BaseModel, Field

from . import store
from .config import FAKE_LLM, VIDEO_SECONDS
from .llm import ask

SYSTEM = """あなたはInstagramリールの企画担当です。
猫や犬などの動物が「人間と同じようなリアルな動き」をするショート動画（AI生成）のネタを考えます。
ヒットの型:
- 誰もが共感する日常のあるある（月曜の朝、ジム、残業、ダイエット、上司、推し活 など）を動物が人間そっくりに演じる
- 最初の1秒で「動物なのに人間の動き」とわかる強い絵（二足立ち、シャドーボクシング、腕組み、ため息 など）
- 背景はリビング・ソファ・オフィス・キッチンなど身近でリアルな場所。スマホで撮ったような自然な画
- 1カット完結、{sec}秒以内で成立する
禁止: 実在の人物・キャラクター・ブランドロゴ、動物虐待に見える表現、他人の投稿の丸パクリ。
video_prompt は動画生成AIに渡す英語プロンプトで、被写体・動き・カメラ・光・質感を具体的に書き、
"photorealistic, shot on smartphone, vertical 9:16" を含めること。"""


class Idea(BaseModel):
    title: str = Field(description="社内向けの短いネタ名（日本語）")
    hook: str = Field(description="最初の1秒で見せる絵（日本語）")
    animal: str
    situation: str = Field(description="共感ポイントになるあるある（日本語）")
    video_prompt: str = Field(description="動画生成AI用の英語プロンプト")
    negative_prompt: str = Field(description="避けたい要素（英語）。例: extra limbs, deformed paws, text, watermark")
    overlay_text: str = Field(description="動画上に載せる短いテロップ（日本語、20文字以内）")
    caption: str = Field(description="投稿キャプション（日本語、絵文字可、2〜3行）")
    hashtags: list[str]
    reason: str = Field(description="伸びると考える理由（日本語）")


class IdeaList(BaseModel):
    ideas: list[Idea]


def generate(n: int = 5) -> list[dict]:
    past = [it["idea"]["title"] for it in store.load()]
    prompt = f"""リールのネタを{n}個考えてください。
これまでに出したネタ（重複禁止）: {past or 'なし'}

分析担当からの学び（あれば最優先で反映）:
{store.learnings() or 'まだデータなし。王道の「人間っぽい猫・犬」から始めてください。'}"""

    if FAKE_LLM:
        ideas = [_sample(i) for i in range(n)]
    else:
        ideas = ask(SYSTEM.format(sec=VIDEO_SECONDS), prompt, IdeaList, effort="high").ideas
    return [store.add(i.model_dump()) for i in ideas]


def _sample(i: int) -> Idea:
    return Idea(
        title=f"月曜朝のジムに向かう猫 #{i + 1}",
        hook="ソファの上で二足立ちしてシャドーボクシングする猫",
        animal="cat",
        situation="月曜の朝、気合いを入れてジムに行く自分",
        video_prompt=(
            "A tabby and white cat standing upright on its hind legs on a navy sofa, "
            "throwing quick boxing punches like a human boxer, mouth open shouting, "
            "natural living room light, photorealistic, shot on smartphone, vertical 9:16"
        ),
        negative_prompt="extra limbs, deformed paws, human hands, text, watermark, logo",
        overlay_text="月曜朝ジムに行く私",
        caption="月曜の朝だけはやる気MAX🥊🐈\n#猫のいる暮らし",
        hashtags=["#猫", "#ねこ動画", "#月曜日", "#筋トレ"],
        reason="サンプル（REELBOT_FAKE_LLM=1）",
    )
