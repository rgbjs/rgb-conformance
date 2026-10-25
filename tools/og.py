#!/usr/bin/env python3
# Draws img/og.png and img/og-spec.png (1200x630). Needs Pillow; font:
# tools/og-fonts/Inter.ttf (SIL OFL).  python3 -I tools/og.py
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'tools/og-fonts/Inter.ttf'
W, H, PAD = 1200, 630, 72
BG_TOP, BG_BOTTOM = (16, 18, 32), (33, 30, 70)
WHITE, SOFT, ACCENT = (255, 255, 255), (200, 202, 222), (140, 156, 255)
V011, V012 = (45, 212, 191), (251, 191, 36)

rules = sum(len(s['rules']) for f in ('v011', 'v012')
            for s in json.load(open(ROOT / f'rules/{f}.jsonld'))['@graph'] if s['@type'] == 'RuleSet')
vectors = len(json.load(open(ROOT / 'vectors/index.json'))['vectors'])

CARDS = {
    'og.png': ('The rules of RGB, tested live in your browser',
               f'{rules} rules for both RGB lines, {vectors} test vectors, every one run in the page.'),
    'og-spec.png': ('RGB conformance specification',
                    f'{rules} rules for v0.11 and v0.12, generated from JSON-LD, each with test vectors.'),
}


def font(size, weight):
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_name(weight)
    return f


def wrap(d, text, f, width):
    lines, cur = [], ''
    for w in text.split():
        t = f'{cur} {w}'.strip()
        if d.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


def pill(d, x, y, text, colour):
    f = font(26, b'SemiBold')
    w = d.textlength(text, font=f)
    d.rounded_rectangle((x, y, x + w + 40, y + 50), radius=25, outline=colour, width=3)
    d.text((x + 20, y + 25), text, font=f, fill=colour, anchor='lm')
    return x + w + 40


for name, (title, desc) in CARDS.items():
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line((0, y, W, y), fill=tuple(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)))
    d.text((PAD, PAD + 20), 'RGB conformance', font=font(40, b'Bold'), fill=ACCENT, anchor='lm')
    y = 180
    tf = font(64, b'Bold')
    for line in wrap(d, title, tf, W - 2 * PAD):
        d.text((PAD, y), line, font=tf, fill=WHITE)
        y += 76
    y += 18
    df = font(30, b'Regular')
    for line in wrap(d, desc, df, W - 2 * PAD)[:3]:
        d.text((PAD, y), line, font=df, fill=SOFT)
        y += 42
    by = H - PAD - 50
    x = pill(d, PAD, by, 'v0.11', V011)
    x = pill(d, x + 14, by, 'v0.12', V012)
    d.text((x + 20, by + 25), 'independent, early', font=font(26, b'Medium'), fill=SOFT, anchor='lm')
    d.text((W - PAD, by + 25), 'rgbjs.github.io/rgb-conformance', font=font(24, b'Medium'), fill=SOFT, anchor='rm')
    img.save(ROOT / 'img' / name, optimize=True)
    print('img/' + name)
