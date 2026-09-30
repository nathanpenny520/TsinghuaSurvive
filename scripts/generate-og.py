#!/usr/bin/env python3
"""
生成站点统一的社交分享卡片图（Open Graph image）。

为什么是「一张统一图」而不是每页动态生成：
每页动态生成要引入 satori / resvg 这类重量级构建依赖，收益远小于成本。
真正决定转发点击率的是 og:title 和 og:description，那两项已经是每页动态的。

用法：
    python3 scripts/generate-og.py

输出：public/og.png（1200×630，微信/微博/Twitter 的通用尺寸）

依赖：Pillow。macOS 上使用系统自带的 Hiragino Sans GB 字体，
      换机器如果找不到字体，脚本会给出明确报错而不是生成一张空白图。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ── 配置 ────────────────────────────────────────────────────────────────
W, H = 1200, 630
BG = (102, 8, 116)  # 清华紫 #660874
BG_DARK = (74, 4, 86)  # 渐变的深色端
ACCENT = (232, 196, 240)  # 浅紫，用于副标题
WHITE = (255, 255, 255)

TITLE = "清华生存指南"
SUBTITLE = "来自学长学姐的经验分享"
TAGS = "选课 · 绩点 · 科研 · 保研 · 生活"
FOOTER = "tsinghua.nathanpenny.fun"

OUT = Path(__file__).resolve().parent.parent / "public" / "og.png"

# 字体候选：(路径, collection index)
FONT_BOLD_CANDIDATES = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),  # W6
    ("/System/Library/Fonts/STHeiti Medium.ttc", 1),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),
]
FONT_REGULAR_CANDIDATES = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),  # W3
    ("/System/Library/Fonts/STHeiti Light.ttc", 1),
]


def load_font(candidates: list[tuple[str, int]], size: int) -> ImageFont.FreeTypeFont:
    """按优先级尝试加载一个中文字体，全部失败则报错退出。"""
    errors = []
    for path, index in candidates:
        try:
            return ImageFont.truetype(path, size, index=index)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"  {path}[{index}]: {exc}")
    raise SystemExit(
        "找不到可用的中文字体，无法生成 OG 图。尝试过：\n"
        + "\n".join(errors)
        + "\n请安装任一中文字体，或修改脚本里的 FONT_*_CANDIDATES。"
    )


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    """画一个竖直渐变背景。逐行画线，1200×630 下耗时可以忽略。"""
    width, height = size
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return img


def hex_label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font, fill) -> None:
    draw.text(xy, text, font=font, fill=fill)


def main() -> int:
    img = vertical_gradient((W, H), BG, BG_DARK)
    draw = ImageDraw.Draw(img, "RGBA")

    # 右上角的装饰圆：让纯色背景不那么呆板
    draw.ellipse([W - 260, -140, W + 160, 280], fill=(255, 255, 255, 14))
    draw.ellipse([W - 150, -60, W + 90, 180], fill=(255, 255, 255, 10))

    f_title = load_font(FONT_BOLD_CANDIDATES, 92)
    f_sub = load_font(FONT_REGULAR_CANDIDATES, 38)
    f_tags = load_font(FONT_REGULAR_CANDIDATES, 30)
    f_footer = load_font(FONT_REGULAR_CANDIDATES, 25)

    left = 88

    # 顶部小标签
    hex_label(draw, (left, 118), "THU · GUIDE", load_font(FONT_REGULAR_CANDIDATES, 22), (255, 255, 255, 130))

    # 主标题
    hex_label(draw, (left, 168), TITLE, f_title, WHITE)

    # 标题下的短横线
    draw.rectangle([left, 300, left + 96, 306], fill=ACCENT)

    # 副标题与标签
    hex_label(draw, (left, 344), SUBTITLE, f_sub, (255, 255, 255, 235))
    hex_label(draw, (left, 404), TAGS, f_tags, ACCENT)

    # 底部域名
    hex_label(draw, (left, H - 84), FOOTER, f_footer, (255, 255, 255, 150))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"已生成 {OUT} （{W}×{H}, {OUT.stat().st_size / 1024:.1f} KB）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
