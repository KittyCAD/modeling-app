"""Shared drawing and GIF export for the README scenes."""
import argparse
from pathlib import Path
import math
import re
import shutil
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

W, H, SCALE, FPS = 1280, 850, 2, 15
BG, PANEL, CODE_BG = '#0b0c10', '#171a22', '#12141b'
TEXT, MUTED, BORDER = '#ffffff', '#b9c1d2', '#495164'
AMBER, CYAN, PURPLE, ACCENT = '#ffb020', '#20d9ff', '#c9a0ff', '#ffffff'
MONO = next((p for p in [Path('/System/Library/Fonts/SFNSMono.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')] if p.exists()), None)
SANS = next((p for p in [Path('/System/Library/Fonts/Supplemental/Arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')] if p.exists()), None)
if MONO is None or SANS is None:
    raise SystemExit('Install DejaVu Sans and DejaVu Sans Mono, or configure MONO/SANS paths.')


def font(size, mono=False):
    return ImageFont.truetype(str(MONO if mono else SANS), round(size * SCALE))


FONTS = {name: font(size, mono) for name, size, mono in [
    ('title', 32, False), ('subtitle', 19, False), ('label', 18, True),
    ('small', 14, False), ('code', 17, True), ('eyebrow', 13, True),
    ('node', 22, True), ('stage', 24, False), ('body', 17, False),
]}


def text(draw, xy, value, style='body', fill=TEXT, anchor=None):
    draw.text(tuple(v * SCALE for v in xy), value, font=FONTS[style], fill=fill, anchor=anchor)


def rect(draw, bounds, fill, outline=None, radius=12, width=1):
    draw.rounded_rectangle(tuple(round(v * SCALE) for v in bounds), radius=round(radius * SCALE), fill=fill, outline=outline, width=round(width * SCALE))


def line(draw, points, fill, width=2):
    draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=fill, width=round(width * SCALE), joint='curve')


def blend(a, b, amount):
    a, b = a.lstrip('#'), b.lstrip('#')
    return tuple(round(int(a[i:i+2], 16) * (1-amount) + int(b[i:i+2], 16) * amount) for i in (0, 2, 4))


def ease(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def bezier(points, t):
    a, b, c, d = points
    return tuple((1-t)**3*a[i] + 3*(1-t)**2*t*b[i] + 3*(1-t)*t*t*c[i] + t**3*d[i] for i in range(2))


def arrow(draw, points, fill, width=2):
    samples = [bezier(points, i/36) for i in range(37)]
    line(draw, samples, fill, width)
    (x, y), (px, py) = samples[-1], samples[-3]
    angle = math.atan2(y-py, x-px)
    tri = [(x,y)] + [(x-10*math.cos(angle+s), y-10*math.sin(angle+s)) for s in (-.5,.5)]
    draw.polygon([(round(x*SCALE), round(y*SCALE)) for x,y in tri], fill=fill)


def draw_code(draw, code, highlighted, final=False):
    for index, value in enumerate(code):
        y = 220 + index*24
        if index == highlighted:
            rect(draw, (45,y-4,518,y+22), '#2c3242', radius=5)
            rect(draw, (45,y-4,48,y+22), ACCENT, radius=1)
        text(draw, (55,y+1), str(index+1).rjust(2), 'eyebrow', '#939cb0')
        x = 88
        # Keep identifiers distinct without tying individual item identity to color.
        tokens = re.findall(r"'[^']*'|//.*|\bconst\b|\bnew\b|\breadonly\b|\bstring\b|\bFacet\b|\bcontribute\b|\bplan\b|[^a-zA-Z'/]+|[a-zA-Z_]+|.", value)
        for token in tokens:
            color = TEXT
            if token.startswith('//'): color = ACCENT if final else MUTED
            elif token.startswith("'"): color = AMBER
            elif token in ('const','new','readonly','string'): color = PURPLE
            elif token in ('Facet','contribute','plan'): color = CYAN
            text(draw, (x,y), token, 'code', color)
            x += draw.textlength(token, font=FONTS['code'])/SCALE


def render_cli(frame, root, name, seconds, poster_time):
    parser = argparse.ArgumentParser(description=f'Render the {name} animation or preview one frame.')
    parser.add_argument('--output', type=Path, default=root/f'{name}.gif', help='GIF destination')
    parser.add_argument('--poster', type=Path, default=root/f'{name}-poster.png', help='Still diagram destination')
    parser.add_argument('--preview-at', type=float, metavar='seconds', help='Render only a still frame at this time')
    parser.add_argument('--fps', type=int, default=FPS, help='GIF frames per second (1–60)')
    args = parser.parse_args()
    if not 1 <= args.fps <= 60:
        parser.error('--fps must be between 1 and 60')
    if args.preview_at is not None and not 0 <= args.preview_at < seconds:
        parser.error(f'--preview-at must be between 0 and {seconds} (exclusive)')
    if args.preview_at is None and not shutil.which('ffmpeg'):
        parser.error('ffmpeg is required for GIF output')
    args.poster.parent.mkdir(parents=True, exist_ok=True)
    frame(args.preview_at if args.preview_at is not None else poster_time).save(args.poster)
    print(args.poster)
    if args.preview_at is not None:
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'plankton-{name}-') as temporary:
        directory=Path(temporary)
        initial=frame(0)
        for i in range(args.fps*seconds):
            t=i/args.fps
            image=frame(t)
            if t>seconds-1:
                image=Image.blend(image,initial,ease(t-(seconds-1)))
            image.save(directory/f'{i:04}.png')
        subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(args.fps),'-i',str(directory/'%04d.png'),'-vf','palettegen=max_colors=96:stats_mode=diff',str(directory/'palette.png')],check=True)
        subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(args.fps),'-i',str(directory/'%04d.png'),'-i',str(directory/'palette.png'),'-lavfi','paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-loop','0',str(args.output)],check=True)
    print(args.output)
