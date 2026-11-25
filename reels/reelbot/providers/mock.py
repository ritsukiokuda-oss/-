"""APIキー無しで流れを試すためのダミー動画（ffmpegで生成）"""
import subprocess
from pathlib import Path


def generate(idea: dict, out: Path, seconds: int) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "lavfi", "-i", f"testsrc2=size=720x1280:rate=30:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)],
        check=True,
    )
    return out
