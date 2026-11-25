"""Instagram Graph API（リール投稿・インサイト取得）"""
import time

import requests

from .config import env, need

METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions",
           "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]


def _url(path: str) -> str:
    return f"{env('IG_GRAPH_HOST', 'https://graph.facebook.com')}/{env('IG_API_VERSION', 'v23.0')}/{path}"


def _call(method: str, path: str, **params) -> dict:
    params["access_token"] = need("IG_ACCESS_TOKEN")
    r = requests.request(method, _url(path), params=params, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Instagram API エラー {r.status_code}: {r.text}")
    return r.json()


def publish_reel(video_url: str, caption: str) -> str:
    """video_url は Instagram から取得できる公開URL（S3・Cloudflare R2 など）"""
    uid = need("IG_USER_ID")
    container = _call("POST", f"{uid}/media", media_type="REELS", video_url=video_url,
                      caption=caption, share_to_feed="true")["id"]
    for _ in range(60):
        status = _call("GET", container, fields="status_code")["status_code"]
        if status == "FINISHED":
            break
        if status == "ERROR":
            raise RuntimeError("Instagram 側の動画処理でエラーになりました")
        time.sleep(10)
    return _call("POST", f"{uid}/media_publish", creation_id=container)["id"]


def insights(media_id: str) -> dict:
    info = _call("GET", media_id, fields="permalink,timestamp,like_count,comments_count")
    result = {"permalink": info.get("permalink"), "timestamp": info.get("timestamp")}
    try:
        data = _call("GET", f"{media_id}/insights", metric=",".join(METRICS))["data"]
        result.update({d["name"]: d["values"][0]["value"] for d in data})
    except RuntimeError as e:  # 指標名の廃止・追加に備えて、取れた分だけ使う
        result["error"] = str(e)
        result.setdefault("likes", info.get("like_count"))
        result.setdefault("comments", info.get("comments_count"))
    return result
