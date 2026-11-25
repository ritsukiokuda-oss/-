"""ffmpeg まわり（リール用 1080x1920 への整形、テロップ、フレーム抽出、情報取得）"""
import json
import subprocess
from pathlib import Path

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",
    "C:/Windows/Fonts/meiryob.ttc",
]


def _font() -> str | None:
    return next((f for f in FONT_CANDIDATES if Path(f).exists()), None)


def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), {})
    return {
        "duration": float(d["format"].get("duration", 0)),
        "width": v.get("width", 0),
        "height": v.get("height", 0),
        "has_audio": any(s["codec_type"] == "audio" for s in d["streams"]),
    }


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019").replace("%", "\\%")


def finish(raw: Path, out: Path, overlay_text: str = "") -> Path:
    """1080x1920・30fps・H.264/AAC に整形し、上部にテロップを入れる（音声が無ければ無音を足す）"""
    info = probe(raw)
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30"
    font = _font()
    if overlay_text and font:
        vf += (f",drawtext=fontfile='{font}':text='{_esc(overlay_text)}':fontsize=64:fontcolor=white"
               ":borderw=6:bordercolor=black:x=(w-text_w)/2:y=h*0.12")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(raw)]
    if not info["has_audio"]:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest"]
    cmd += ["-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)
    return out


def frames(path: Path, n: int = 6) -> list[Path]:
    """チェック用に動画から均等に n 枚のフレームを抜き出す"""
    dur = probe(path)["duration"] or 1
    outs = []
    for i in range(n):
        t = dur * (i + 0.5) / n
        p = path.with_name(f"{path.stem}_f{i}.jpg")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", str(path),
                        "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", str(p)], check=True)
        outs.append(p)
    return outs
