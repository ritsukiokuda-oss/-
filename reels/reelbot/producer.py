"""制作担当: ネタから動画を生成し、リール用に仕上げる"""
from . import media, providers, store
from .config import env, PRICE_PER_SEC, VIDEO_PROVIDER, VIDEO_SECONDS, VIDEOS


def billed_seconds() -> int:
    """サービスごとに実際に課金される秒数（Kling 3.0 は3〜15秒、Runway は5秒か10秒、Veo は4〜8秒）"""
    if VIDEO_PROVIDER == "kling":
        if env("KLING_MODEL", "kling-3.0").startswith("kling-2"):
            return 10 if VIDEO_SECONDS > 5 else 5
        return min(max(VIDEO_SECONDS, 3), 15)
    if VIDEO_PROVIDER == "runway":
        return 10 if VIDEO_SECONDS > 5 else 5
    if VIDEO_PROVIDER == "veo":
        return min(max(VIDEO_SECONDS, 4), 8)
    return VIDEO_SECONDS


def produce(item: dict) -> dict:
    idea = item["idea"]
    attempt = item.get("attempts", 0) + 1
    raw = VIDEOS / f"{item['id']}_v{attempt}_raw.mp4"
    final = VIDEOS / f"{item['id']}_v{attempt}.mp4"

    print(f"[制作] {item['id']} 「{idea['title']}」を {VIDEO_PROVIDER} で生成中（{attempt}回目）…")
    providers.get().generate(idea, raw, VIDEO_SECONDS)
    media.finish(raw, final, idea.get("overlay_text", ""))

    cost = round(item.get("cost_usd", 0) + PRICE_PER_SEC.get(VIDEO_PROVIDER, 0) * billed_seconds(), 3)
    return store.update(item, f"制作: {final.name} を作成（{VIDEO_PROVIDER}）",
                        status="produced", video=str(final), attempts=attempt, cost_usd=cost)
