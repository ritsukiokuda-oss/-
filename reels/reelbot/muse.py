"""Muse（Meta の AI 秘書アプリ）との受け渡し

Muse には API が無いため、テキストのコピー＆ペーストでやり取りする。
- brief():        Muse に貼る最新の引き継ぎ文（ルール・過去ネタ・チェックで多い失敗・数字）
- parse_ideas():  Muse が出したネタ（決まった書式）を台帳用の dict に変換
- stats_table():  投稿の数字を Muse に分析してもらうための表
"""
import json
import re
from collections import Counter

from . import store
from .config import VIDEO_SECONDS

LABELS = {
    "タイトル": "title", "ネタ名": "title",
    "動物": "animal",
    "あるある": "situation", "シチュエーション": "situation",
    "つかみ": "hook", "最初の1秒": "hook",
    "英語プロンプト": "video_prompt", "プロンプト": "video_prompt",
    "避けたいもの": "negative_prompt", "ネガティブ": "negative_prompt",
    "テロップ": "overlay_text",
    "キャプション": "caption",
    "ハッシュタグ": "hashtags",
    "狙い": "reason", "理由": "reason",
}
SPLIT = re.compile(r"^\s*(?:-{3,}|={3,}|[#＃]*\s*【?\s*ネタ\s*[0-9０-９]+.*)\s*$")
LABEL_RE = re.compile(r"^\s*[-・*]*\s*\**\s*(" + "|".join(map(re.escape, sorted(LABELS, key=len, reverse=True))) + r")\s*\**\s*[:：]\s*(.*)$")

FORMAT = """ネタ1
タイトル: （社内向けの短い名前）
動物: （猫 / 犬 など）
あるある: （共感ポイント）
つかみ: （最初の1秒で見せる絵）
英語プロンプト: （動画AIに渡す英語の指示文。1段落）
避けたいもの: extra limbs, deformed paws, human hands, text, watermark, logo
テロップ: （20文字以内）
キャプション: （2〜3行、絵文字OK）
ハッシュタグ: #猫 #ねこ動画 …
狙い: （伸びると思う理由）"""


def _clean(v: str) -> str:
    return v.strip().strip("*").strip().strip("「」\"'`").strip()


def parse_ideas(text: str) -> list[dict]:
    text = text.strip()
    # JSON で返ってきた場合（```json … ``` も可）
    m = re.search(r"(\{.*\}|\[.*\])", text, re.S)
    if m:
        try:
            data = json.loads(m.group(1))
            items = data.get("ideas", data) if isinstance(data, dict) else data
            if isinstance(items, list) and items and isinstance(items[0], dict):
                return [_normalize(i) for i in items]
        except json.JSONDecodeError:
            pass

    blocks, cur, key = [], {}, None
    for line in text.splitlines():
        if SPLIT.match(line):
            if cur:
                blocks.append(cur)
            cur, key = {}, None
            continue
        lm = LABEL_RE.match(line)
        if lm:
            field = LABELS[lm.group(1)]
            if field == "title" and cur.get("title"):  # 区切り無しで次のネタが始まった
                blocks.append(cur)
                cur = {}
            key = field
            cur[key] = _clean(lm.group(2))
        elif key and line.strip():  # 前の項目の続き（複数行のキャプションなど）
            cur[key] = (cur[key] + "\n" + line.strip()).strip()
    if cur:
        blocks.append(cur)
    return [_normalize(b) for b in blocks if b.get("title") or b.get("video_prompt")]


def _normalize(d: dict) -> dict:
    d = {LABELS.get(k, k): v for k, v in d.items()}
    tags = d.get("hashtags", [])
    if isinstance(tags, str):
        tags = [t if t.startswith("#") else f"#{t}" for t in re.split(r"[\s,、]+", tags) if t.strip("#")]
    if not d.get("video_prompt"):
        raise ValueError(f"「{d.get('title', '?')}」に英語プロンプトがありません")
    return {
        "title": d.get("title") or d["video_prompt"][:30],
        "hook": d.get("hook", ""),
        "animal": d.get("animal", ""),
        "situation": d.get("situation", ""),
        "video_prompt": d["video_prompt"],
        "negative_prompt": d.get("negative_prompt", "extra limbs, deformed paws, human hands, text, watermark, logo"),
        "overlay_text": d.get("overlay_text", ""),
        "caption": d.get("caption", ""),
        "hashtags": tags,
        "reason": d.get("reason", "Muse 提案"),
        "source": "muse",
    }


def stats_table() -> str:
    rows = [it for it in store.load() if it.get("stats")]
    if not rows:
        return "（まだ数字がありません）"
    keys = ["views", "reach", "likes", "comments", "shares", "saved", "ig_reels_avg_watch_time"]
    head = "| ネタ | 動物 | テロップ | チェック点 | " + " | ".join(keys) + " |"
    lines = [head, "|" + "---|" * (len(keys) + 4)]
    for it in rows:
        s, i = it["stats"], it["idea"]
        lines.append(f"| {i['title']} | {i['animal']} | {i['overlay_text']} | {it.get('review', {}).get('score', '-')} | "
                     + " | ".join(str(s.get(k, "-")) for k in keys) + " |")
    return "\n".join(lines)


def brief() -> str:
    items = store.load()
    past = [it["idea"]["title"] for it in items]
    issues = Counter(x for it in items for x in it.get("review", {}).get("issues", []))
    good = [it["idea"]["title"] for it in items if it["status"] in ("approved", "published")]
    return f"""# Instagramリール ネタ担当・分析担当の引き継ぎ

あなたには、猫や犬が「人間と同じようなリアルな動き」をするAI生成リールの **ネタ出し** と **数字の振り返り** をお願いします。
動画の生成（Kling）と品質チェックは別のプログラムが自動で行います。あなたの出す「英語プロンプト」がそのまま動画AIに渡ります。

## ネタのルール
- 誰もが共感する日常のあるある（月曜の朝、ジム、残業、ダイエット、上司、推し活 など）を、動物が人間そっくりに演じる
- 最初の1秒で「動物なのに人間の動き」とわかる強い絵（二足立ち、シャドーボクシング、腕組み、ため息 など）
- 背景はリビング・ソファ・オフィス・キッチンなど身近な場所。スマホで撮ったような自然な画
- 1カット完結、{VIDEO_SECONDS}秒以内で成立する（場面転換やセリフに頼らない）
- 英語プロンプトには 被写体・動き・カメラ・光・質感 を具体的に書き、最後に "photorealistic, shot on smartphone, vertical 9:16" を入れる
- 禁止: 実在の人物・キャラクター・ブランドロゴ、動物虐待に見える表現、他人の投稿の丸写し

## 出力の書式（この形のまま返してください。プログラムが読み取ります）
```
{FORMAT}

ネタ2
タイトル: …
```

## これまでに出したネタ（重複しないでください）
{chr(10).join(f"- {t}" for t in past) or "- まだありません"}

## 採用・投稿されたネタ
{chr(10).join(f"- {t}" for t in good) or "- まだありません"}

## 品質チェックで多かった失敗（プロンプトで避けてください）
{chr(10).join(f"- {k}（{v}回）" for k, v in issues.most_common(8)) or "- まだありません"}

## 投稿の数字
{stats_table()}

## 振り返りのお願い（数字がある時）
平均視聴時間（つかみと完走）、シェアと保存（拡散力）、再生数を重視して、
何が伸びて何が伸びなかったかを「次のネタ出しにそのまま使える学び」として3〜5行でまとめてください。
投稿数が少ないうちは断定せず仮説として書いてください。
"""
