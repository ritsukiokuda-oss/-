"""全担当が共有する制作台帳（data/board.json）"""
import json
import uuid
from datetime import datetime, timezone

from .config import DATA

BOARD = DATA / "board.json"
LEARNINGS = DATA / "learnings.md"

# 状態の流れ: idea → produced → checked_ok / checked_ng → approved → published
STATUSES = ["idea", "produced", "checked_ok", "checked_ng", "approved", "published", "rejected"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load() -> list[dict]:
    if not BOARD.exists():
        return []
    return json.loads(BOARD.read_text(encoding="utf-8"))


def save(items: list[dict]) -> None:
    BOARD.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def add(idea: dict) -> dict:
    items = load()
    item = {"id": uuid.uuid4().hex[:6], "status": "idea", "created_at": now(), "idea": idea, "log": []}
    items.append(item)
    save(items)
    return item


def get(item_id: str) -> dict:
    for it in load():
        if it["id"] == item_id:
            return it
    raise SystemExit(f"ID {item_id} が見つかりません")


def update(item: dict, note: str | None = None, **fields) -> dict:
    items = load()
    for i, it in enumerate(items):
        if it["id"] == item["id"]:
            it.update(fields)
            if note:
                it["log"].append(f"{now()} {note}")
            items[i] = it
            save(items)
            return it
    raise SystemExit(f"ID {item['id']} が見つかりません")


def by_status(status: str) -> list[dict]:
    return [it for it in load() if it["status"] == status]


def learnings() -> str:
    return LEARNINGS.read_text(encoding="utf-8") if LEARNINGS.exists() else ""
