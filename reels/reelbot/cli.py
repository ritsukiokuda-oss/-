"""使い方: python -m reelbot <コマンド>"""
import argparse

from . import store
from .config import MAX_RETRIES, PRICE_PER_SEC, VIDEO_PROVIDER, VIDEO_SECONDS


def cmd_ideas(a):
    from .ideas import generate

    for it in generate(a.n):
        print(f"[ネタ] {it['id']}  {it['idea']['title']}  — {it['idea']['reason']}")


def _make(item):
    """制作 → チェック。不合格なら改良プロンプトで作り直す"""
    from .checker import check
    from .producer import produce

    for _ in range(MAX_RETRIES + 1):
        item = check(produce(item))
        if item["status"] == "checked_ok":
            return item
    print(f"[チェック] {item['id']} は {MAX_RETRIES + 1} 回作っても合格せず。人の判断待ちです。")
    return item


def cmd_produce(a):
    targets = [store.get(a.id)] if a.id else store.by_status("idea")[: a.n]
    if not targets:
        print("制作待ちのネタがありません。先に `ideas` を実行してください。")
    for it in targets:
        _make(it)


def cmd_run(a):
    from .ideas import generate

    for it in generate(a.n):
        _make(it)
    cmd_status(a)


def cmd_approve(a):
    it = store.get(a.id)
    if it["status"] != "checked_ok" and not a.force:
        raise SystemExit(f"{a.id} はチェック未合格（{it['status']}）です。承認するなら --force を付けてください。")
    store.update(it, "人が最終承認", status="approved")
    print(f"{a.id} を承認しました。動画: {it['video']}")


def cmd_reject(a):
    store.update(store.get(a.id), "不採用", status="rejected")


def cmd_publish(a):
    from .instagram import publish_reel

    it = store.get(a.id)
    if it["status"] != "approved":
        raise SystemExit("人の承認（approve）が済んだ動画だけ投稿できます。")
    idea = it["idea"]
    caption = idea["caption"] + "\n\n" + " ".join(idea["hashtags"])
    media_id = publish_reel(a.video_url, caption)
    store.update(it, f"投稿: media_id={media_id}", status="published", media_id=media_id)
    print(f"投稿しました media_id={media_id}")


def cmd_mark_published(a):
    """アプリから手動投稿した場合に、分析用のメディアIDを登録する"""
    store.update(store.get(a.id), f"手動投稿を登録 media_id={a.media_id}", status="published", media_id=a.media_id)


def cmd_analyze(a):
    from .analyst import analyze

    print(analyze())
    print(f"学びを {store.LEARNINGS} に保存しました。次回の `ideas` で自動的に使われます。")


def cmd_status(a):
    items = store.load()
    total = sum(it.get("cost_usd", 0) for it in items)
    for it in items:
        sc = it.get("review", {}).get("score", "-")
        views = it.get("stats", {}).get("views", "-")
        print(f"{it['id']}  {it['status']:<11} 点数:{sc!s:>3}  再生:{views!s:>7}  ${it.get('cost_usd', 0):<6} {it['idea']['title']}")
    print(f"\n動画生成コスト合計（目安）: ${total:.2f}")


def cmd_cost(a):
    from .producer import billed_seconds

    per = PRICE_PER_SEC.get(VIDEO_PROVIDER, 0) * billed_seconds()
    tries = 1.5  # チェック不合格で作り直す分を平均1.5本と仮定
    print(f"{VIDEO_PROVIDER}: 1本 {billed_seconds()}秒 = ${per:.2f}、作り直し込み約 ${per * tries:.2f}")
    print(f"毎日1本投稿 → 月 約 ${per * tries * 30:.0f}（Claude 利用料は別途、月数ドル程度）")


def main():
    p = argparse.ArgumentParser(prog="reelbot", description="Instagram リール自動制作（ネタ・制作・チェック・分析）")
    sp = p.add_subparsers(required=True)

    s = sp.add_parser("ideas", help="ネタ担当: ネタを考える"); s.add_argument("-n", type=int, default=5); s.set_defaults(f=cmd_ideas)
    s = sp.add_parser("produce", help="制作担当+チェック担当: 動画を作って検品")
    s.add_argument("--id"); s.add_argument("-n", type=int, default=1); s.set_defaults(f=cmd_produce)
    s = sp.add_parser("run", help="ネタ出し→制作→チェックを一気に実行"); s.add_argument("-n", type=int, default=1); s.set_defaults(f=cmd_run)
    s = sp.add_parser("approve", help="人の最終承認"); s.add_argument("id"); s.add_argument("--force", action="store_true"); s.set_defaults(f=cmd_approve)
    s = sp.add_parser("reject", help="不採用にする"); s.add_argument("id"); s.set_defaults(f=cmd_reject)
    s = sp.add_parser("publish", help="承認済み動画を Instagram に投稿")
    s.add_argument("id"); s.add_argument("--video-url", required=True, help="動画の公開URL"); s.set_defaults(f=cmd_publish)
    s = sp.add_parser("mark-published", help="手動投稿した動画のメディアIDを登録")
    s.add_argument("id"); s.add_argument("media_id"); s.set_defaults(f=cmd_mark_published)
    s = sp.add_parser("analyze", help="分析担当: 数字を集めて学びをまとめる"); s.set_defaults(f=cmd_analyze)
    s = sp.add_parser("status", help="制作台帳を表示"); s.set_defaults(f=cmd_status)
    s = sp.add_parser("cost", help="コストの目安"); s.set_defaults(f=cmd_cost)

    a = p.parse_args()
    a.f(a)
