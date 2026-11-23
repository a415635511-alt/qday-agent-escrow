"""Render the BUIDL cover (1280x640) from the real deployment facts."""
from pathlib import Path
import json
import textwrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1280, 640
BG = (12, 16, 24)
CARD = (20, 26, 38)
FG = (232, 236, 244)
MUTED = (138, 150, 170)
ACCENT = (86, 156, 255)
GREEN = (72, 199, 142)

FONT_CANDIDATES = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"]
MONO_CANDIDATES = [r"C:\Windows\Fonts\consola.ttf"]


def load(cands, size):
    for p in cands:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


dep = json.loads((ROOT / "deployment.json").read_text(encoding="utf-8"))
f_title = load(FONT_CANDIDATES, 64)
f_sub = load(FONT_CANDIDATES, 27)
f_body = load(FONT_CANDIDATES, 23)
f_mono = load(MONO_CANDIDATES, 19)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 6], fill=ACCENT)

d.text((56, 54), "AgentPayGuard", font=f_title, fill=FG)
d.text((58, 132), "tUSD8 escrow an AI agent can use without draining the treasury", font=f_sub, fill=ACCENT)

points = [
    "Confirmation of Payee checked on-chain before any token moves",
    "Per-invoice and rolling 24h caps enforced by the contract",
    "One-transaction revocation, deliverable hash before release",
]
y = 196
for p in points:
    d.ellipse([58, y + 9, 68, y + 19], fill=GREEN)
    d.text((84, y), p, font=f_body, fill=FG)
    y += 44

d.rectangle([56, 356, W - 56, 552], fill=CARD, outline=(40, 50, 68))
d.text((84, 378), "Live on QDay Aevum testnet · chain 44005 · source verified", font=f_body, fill=GREEN)
d.text((84, 418), dep["agentPayGuard"], font=f_mono, fill=ACCENT)
d.text((84, 448), "settled a real 1.5 tUSD8 invoice across treasury / agent / supplier", font=f_body, fill=FG)
d.text((84, 486), "9/9 receipts status=1 · cap refusals and revocation proven on chain", font=f_body, fill=MUTED)

d.text((56, 580), "github.com/a415635511-alt/qday-agent-escrow", font=f_mono, fill=MUTED)

out = ROOT / "cover.png"
img.save(out)
print("wrote", out, img.size)
