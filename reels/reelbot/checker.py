"""チェック担当: 技術チェック + Claude による映像の目視チェック"""
from pathlib import Path

from pydantic import BaseModel, Field

from . import media, store
from .config import CHECK_PASS_SCORE, FAKE_LLM
from .llm import ask

SYSTEM = """あなたはInstagramリールの品質チェック担当です。動画から均等に抜き出したフレームを見て厳しく判定します。
チェック項目:
1. AI生成の破綻: 足や指の本数、手足の融合、顔の崩れ、体の変形、背景のゆがみ、フレーム間で模様や色が変わる
2. リアルさ: 毛並み・光・影が自然か。「動物が人間のように動いている」ことが一目でわかるか
3. 最初のフレームのつかみ: 1秒目で止まって見たくなる絵か
4. テロップ: 読めるか、顔や重要部分に被っていないか
5. 規約・炎上リスク: 実在人物・ロゴ・著作物、動物虐待に見える表現、不快な表現がないか
score は0〜100。致命的な破綻（足が増える等）があれば50未満にしてください。
improved_prompt には、問題を直すための改良版の英語プロンプトを書いてください（問題が無ければ元のまま）。"""


class Review(BaseModel):
    score: int = Field(ge=0, le=100)
    issues: list[str] = Field(description="見つかった問題（日本語）。無ければ空")
    good_points: list[str]
    improved_prompt: str


def technical(info: dict) -> list[str]:
    errs = []
    if not 3 <= info["duration"] <= 90:
        errs.append(f"長さ {info['duration']:.1f}秒（リールは3〜90秒）")
    if (info["width"], info["height"]) != (1080, 1920):
        errs.append(f"解像度 {info['width']}x{info['height']}（1080x1920 推奨）")
    if not info["has_audio"]:
        errs.append("音声トラックなし")
    return errs


def check(item: dict) -> dict:
    video = Path(item["video"])
    tech = technical(media.probe(video))
    shots = media.frames(video)
    idea = item["idea"]

    if FAKE_LLM:
        review = Review(score=80, issues=[], good_points=["サンプル判定"], improved_prompt=idea["video_prompt"])
    else:
        review = ask(
            SYSTEM,
            f"ネタ: {idea['title']}\n狙い: {idea['hook']}\nテロップ: {idea['overlay_text']}\n"
            f"使用プロンプト: {idea['video_prompt']}\n"
            f"フレームは時系列順に{len(shots)}枚です。",
            Review,
            images=shots,
        )
    for s in shots:
        s.unlink(missing_ok=True)

    ok = review.score >= CHECK_PASS_SCORE and not tech
    result = {"score": review.score, "issues": tech + review.issues, "good_points": review.good_points}
    note = f"チェック: {review.score}点 {'合格' if ok else '不合格'} {'; '.join(result['issues'])}"
    print(f"[チェック] {item['id']} {note}")
    if not ok and review.improved_prompt:
        idea = {**idea, "video_prompt": review.improved_prompt}
    return store.update(item, note, status="checked_ok" if ok else "checked_ng", review=result, idea=idea)
