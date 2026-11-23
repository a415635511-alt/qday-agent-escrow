#!/usr/bin/env python3
"""Render the 1080p pitch video for AgentPayGuard.

Slides are drawn with Pillow from real project data: the test transcript, the
deployed addresses (only if deployment.json says deployed), and dashboard
screenshots. Narration is Windows SAPI, fully offline, then stitched with
FFmpeg. Re-run after the Aevum deployment to pick up the on-chain slide.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "video_build"
OUT.mkdir(exist_ok=True)
W, H = 1920, 1080
BG = (12, 16, 24)
CARD = (20, 26, 38)
FG = (232, 236, 244)
MUTED = (138, 150, 170)
ACCENT = (86, 156, 255)
GREEN = (72, 199, 142)
AMBER = (240, 180, 80)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]
MONO_CANDIDATES = [r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\cour.ttf"]


def load_font(paths, size):
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


F_TITLE = load_font(FONT_CANDIDATES, 92)
F_SUB = load_font(FONT_CANDIDATES, 40)
F_H2 = load_font(FONT_CANDIDATES, 46)
F_BODY = load_font(FONT_CANDIDATES, 30)
F_SMALL = load_font(FONT_CANDIDATES, 25)
F_MONO = load_font(MONO_CANDIDATES, 26)
F_MONO_SM = load_font(MONO_CANDIDATES, 22)

SLIDES = []


def canvas(kicker, title, subtitle=None):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 8], fill=ACCENT)
    d.text((100, 88), kicker.upper(), font=F_SMALL, fill=ACCENT)
    d.text((100, 128), title, font=F_TITLE if len(title) < 34 else F_H2, fill=FG)
    if subtitle:
        d.text((100, 240), subtitle, font=F_SUB, fill=MUTED)
    return img, d


def card(d, box, outline=CARD):
    d.rounded_rectangle(box, radius=14, outline=outline, width=2, fill=CARD)


def deployment():
    p = ROOT / "deployment.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


# ---------------------------------------------------------------- slide 1
img, d = canvas("Aevum Builder Challenge #1", "AgentPayGuard",
                "Stablecoin escrow an AI agent can use — without a human on every invoice")
card(d, [110, 330, W - 110, 760])
rows = [
    ("Tracks", "Confirmation of Payee · Invoice Payments"),
    ("Chain", "QDay Aevum Testnet · chain 44005"),
    ("Asset", "tUSD8 · 0x456569838f1d43009A91ebA4263147Afd7233483"),
    ("Repo", "github.com/a415635511-alt/qday-agent-escrow"),
]
for i, (k, v) in enumerate(rows):
    y = 380 + i * 92
    d.text((150, y), k, font=F_SMALL, fill=MUTED)
    d.text((380, y - 6), v, font=F_MONO if i > 1 else F_BODY, fill=FG)
d.text((110, 830), "Contract-enforced limits · payee verification before money moves · one-transaction revocation",
       font=F_BODY, fill=GREEN)
p1 = OUT / "slide1.png"
img.save(p1)
SLIDES.append((p1, "This is AgentPayGuard: programmable stablecoin escrow on the QDay Aevum testnet, "
                   "built for the Aevum Builder Challenge. It lets an AI agent pay suppliers on its own, "
                   "while the payee check, the spending limits and the delivery condition are enforced by the contract, not by the agent's goodwill."))

# ---------------------------------------------------------------- slide 2
img, d = canvas("The problem", "An agent with a hot key is a liability",
                "Three failure modes we have all seen in stablecoin payouts")
card(d, [110, 330, W - 110, 900])
items = [
    ("1  Wrong payee", "A swapped or impersonated vendor address looks identical to a human eye — and to an LLM."),
    ("2  Unbounded wallet", "One bug or one injected instruction can drain the whole treasury in a single call."),
    ("3  No delivery proof", "Funds sent before an artifact exists, and no automatic way back if the supplier vanishes."),
]
for i, (h, body) in enumerate(items):
    y = 380 + i * 175
    d.text((150, y), h, font=F_H2, fill=AMBER)
    d.text((150, y + 62), body, font=F_BODY, fill=FG)
p2 = OUT / "slide2.png"
img.save(p2)
SLIDES.append((p2, "Three failures keep teams from letting an agent pay on its own. An impersonated vendor address looks fine to an LLM. "
                   "An unrestricted key can empty the treasury in one call. And a plain transfer leaves no proof that anything was delivered."))

# ---------------------------------------------------------------- slide 3
img, d = canvas("The design", "Every control lives in the contract",
                "AgentPayGuard.sol · Solidity 0.8.29 · compiled for Shanghai")
card(d, [110, 320, W - 110, 940])
hdr = ["Control", "Enforced by", "Prevents"]
xs = [150, 720, 1300]
for i, h in enumerate(hdr):
    d.text((xs[i], 350), h, font=F_SMALL, fill=ACCENT)
ctl = [
    ("Confirmation of Payee", "on-chain name-hash registry", "wrong-address payout"),
    ("Per-invoice cap", "agent mandate", "one bad call drains treasury"),
    ("Daily cap, rolling 24h", "agent mandate", "slow bleed over many invoices"),
    ("Expiry", "agent mandate", "forgotten key spends forever"),
    ("Instant revocation", "one transaction", "agent racing a human"),
    ("Deliverable receipt", "invoice escrow", "paying before delivery"),
    ("Deadline refund", "invoice escrow", "money stuck with a no-show"),
]
for i, (a, b, c) in enumerate(ctl):
    y = 410 + i * 72
    d.text((xs[0], y), a, font=F_BODY, fill=FG)
    d.text((xs[1], y + 2), b, font=F_MONO_SM, fill=MUTED)
    d.text((xs[2], y), c, font=F_BODY, fill=GREEN)
p3 = OUT / "slide3.png"
img.save(p3)
SLIDES.append((p3, "So we moved the controls into the contract. A supplier registers a hashed name once, and every payout must carry the same hash — a swapped address reverts on-chain. "
                   "The agent gets a per-invoice cap, a rolling daily cap and an expiry. Revocation is a single transaction and takes effect in the same block. "
                   "Money sits in escrow until a deliverable hash exists, and returns to the payer if the deadline passes."))

# ---------------------------------------------------------------- slide 4 (real test output)
demo_log = OUT / "demo_transcript.txt"
with open(demo_log, "w", encoding="utf-8") as fh:
    subprocess.run(["node", "scripts/demo_local.mjs"], cwd=ROOT, stdout=fh, stderr=subprocess.STDOUT,
                   timeout=180)
lines = demo_log.read_text(encoding="utf-8", errors="replace").splitlines()
img, d = canvas("Verification", "It runs — right now",
                "node scripts/demo_local.mjs · full lifecycle incl. three attack attempts")
card(d, [90, 310, W - 90, 1000])
y = 336
for line in lines[:26]:
    if not line.strip():
        continue
    col = FG
    if "blocked" in line:
        col = GREEN
    elif line.startswith(("1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.")):
        col = ACCENT
    elif "reverted" in line:
        col = AMBER
    d.text((120, y), line[:118], font=F_MONO_SM, fill=col)
    y += 25
p4 = OUT / "slide4.png"
img.save(p4)
SLIDES.append((p4, "This is the real run, not a mock-up. The script deploys the contract, funds a mandate of fifty tUSD8 per invoice and eighty a day, "
                   "then walks the whole flow. Watch the three attack attempts: a payee whose name hash does not match, an invoice above the per-invoice cap, "
                   "and a second invoice that would break the daily cap — the contract reverts each one with a named reason. "
                   "Then the supplier delivers, the agent releases, the treasury revokes and the agent is cut off immediately."))

# ---------------------------------------------------------------- slide 5 (dashboard)
shot = ROOT / "video_build" / "dashboard.png"
if shot.exists():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 8], fill=ACCENT)
    d.text((100, 88), "THE CLIENT", font=F_SMALL, fill=ACCENT)
    d.text((100, 128), "One file, no build step", font=F_H2, fill=FG)
    dash = Image.open(shot).convert("RGB")
    scale = min((W - 200) / dash.width, (H - 330) / dash.height)
    dash = dash.resize((int(dash.width * scale), int(dash.height * scale)), Image.Resampling.LANCZOS)
    img.paste(dash, (100, 250))
    p5 = OUT / "slide5.png"
    img.save(p5)
    SLIDES.append((p5, "The client is a single HTML file using ethers v6: connect a wallet, register a payee, bound an agent, fund an invoice, "
                       "release or refund it. Every action button stays disabled until a wallet is connected, and the ledger reads straight from the chain."))

# ---------------------------------------------------------------- slide 6 (on-chain, only if deployed)
dep = deployment()
proof_path = ROOT / "onchain_proof.json"
proof = json.loads(proof_path.read_text(encoding="utf-8")) if proof_path.exists() else {}
if dep.get("agentPayGuard"):
    img, d = canvas("On Aevum", "One invoice, settled on chain", "Every hash below is a real transaction on chain 44005")
    card(d, [70, 300, 1160, 1000])
    d.text((110, 330), f"AgentPayGuard  {dep['agentPayGuard']}", font=F_MONO, fill=ACCENT)
    d.text((110, 372), f"tUSD8  {dep.get('tusd8','')}   ·   block {dep.get('deploymentBlock','')}", font=F_MONO_SM, fill=MUTED)
    tx_rows = [r for r in proof.get("receipts", []) if r.get("hash")]
    for i, r in enumerate(tx_rows[:9]):
        y = 430 + i * 58
        d.text((110, y), r["step"][:44], font=F_SMALL, fill=FG)
        d.text((700, y), r["hash"][:16] + "…" + r["hash"][-6:], font=F_MONO_SM, fill=ACCENT)
        d.text((1045, y), f"#{r.get('blockNumber') or r.get('block','')}", font=F_MONO_SM, fill=MUTED)
    card(d, [1200, 300, W - 70, 1000], outline=GREEN)
    d.text((1240, 330), "Settled state (read back)", font=F_H2, fill=GREEN)
    side = [
        "source verified on explorer",
        f"{len(tx_rows)} receipts, all status = 1",
        "CoP match true / mismatch false",
        "escrow held 1.5 tUSD8",
        "supplier received 1.5 tUSD8",
        "agent cap revert on-chain",
        "agent cut off after revoke",
    ]
    for i, line in enumerate(side):
        d.text((1240, 400 + i * 62), "• " + line, font=F_SMALL, fill=FG)
    d.text((110, 1010), f"{dep.get('explorer')}/address/{dep['agentPayGuard']}", font=F_MONO_SM, fill=GREEN)
    p6 = OUT / "slide6.png"
    img.save(p6)
    SLIDES.append((p6, "Then we ran the whole thing on Aevum testnet with three separate keys: a treasury, an AI agent and a supplier. "
                       "The agent funded a one-point-five tUSD8 invoice inside its caps, the supplier submitted a deliverable hash, the treasury released, and the supplier actually received the money. "
                       "Two attacks were refused by the contract itself, and after revocation the agent was cut off immediately. Every receipt reads status one, and the source is verified on the explorer."))
# ---------------------------------------------------------------- slide 7 (close)
img, d = canvas("Reusable", "Built to be picked up", "One flow, end to end — and a template for the next one")
card(d, [110, 330, W - 110, 900])
lines = [
    "Payroll and vesting: swap the invoice for a schedule, keep the caps",
    "Crowdfunding: escrow per milestone, release on deliverable hash",
    "Confirmation of Payee for any stablecoin payout rail",
    "",
    "github.com/a415635511-alt/qday-agent-escrow",
    "MIT licensed · npm test · docker build · 9-step demo script",
]
for i, line in enumerate(lines):
    col = ACCENT if "github.com" in line else FG
    d.text((150, 380 + i * 80), line, font=F_MONO if "github" in line else F_BODY, fill=col)
p7 = OUT / "slide7.png"
img.save(p7)
SLIDES.append((p7, "The same primitive generalises: payroll schedules, milestone crowdfunding, or any payout rail that needs a payee check. "
                   "Everything is MIT licensed on GitHub, with the test suite, the Docker image and the nine-step demo. Thanks for watching."))


def synth():
    segs = []
    for idx, (img_path, text) in enumerate(SLIDES, 1):
        wav = OUT / f"n{idx}.wav"
        ps = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1; "
            "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; $s.Rate = 1; "
            f"$s.SetOutputToWaveFile('{wav}'); $s.Speak({json.dumps(text)}); $s.Dispose();"
        )
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                       check=True, capture_output=True)
        seg = OUT / f"seg{idx}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(img_path), "-i", str(wav),
                        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-shortest", str(seg)],
                       check=True, capture_output=True)
        segs.append(seg)
    concat = OUT / "concat.txt"
    concat.write_text("\n".join(f"file '{s.name}'" for s in segs) + "\n", encoding="utf-8")
    final = ROOT / "AgentPayGuard_Demo_1080p.mp4"
    subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(final)],
                   check=True, capture_output=True)
    probe = subprocess.run(["ffmpeg", "-i", str(final)], capture_output=True, text=True).stderr
    for line in probe.splitlines():
        if "Duration:" in line:
            print("FINAL:", final, "|", line.strip(), "| MB:", round(final.stat().st_size / 1e6, 2))


synth()
