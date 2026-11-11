#!/usr/bin/env python3
"""Spot 03's own small sounds (the kinds sound.mjs has not got), synthesised, seeded, 48 kHz 16-bit mono WAVs in
spots/03-sfx/: creak.wav (the bar taking his weight), rustle.wav (the scraps going), pencil.wav (the outline drawing
itself, 1.1 s), pen.wav (one dip-pen word), tock.wav (the wink). Also cuts the portrait line voice/03-5.wav at its
sentence pauses into voice/03-5a..f.wav (the cut points are the energy segments, a 60 ms lead and a 120 ms tail).

    python3 -I spots/03-sfx.py        (from tools/media/ad)
"""
import os, wave, numpy as np

SR = 48000
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "03-sfx")
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(303)


def save(name, x, peak=0.8):
    x = np.asarray(x, dtype=float)
    m = np.max(np.abs(x)) or 1
    x = x / m * peak
    with wave.open(name, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def reson(x, f, q):
    """A two-pole resonator (band-pass) at f Hz."""
    r = np.exp(-np.pi * f / q / SR); c = 2 * r * np.cos(2 * np.pi * f / SR); y = np.zeros_like(x); y1 = y2 = 0.0
    for i, v in enumerate(x):
        y0 = (1 - r) * v + c * y1 - r * r * y2; y[i] = y0; y2, y1 = y1, y0
    return y


def onepole(x, a):
    y = np.zeros_like(x); s = 0.0
    for i, v in enumerate(x):
        s += a * (v - s); y[i] = s
    return y


def env(n, a, r):
    t = np.arange(n) / SR; T = n / SR
    return np.clip(np.minimum(t / a, (T - t) / r), 0, 1) ** 1.5


# the creak: stick-slip impulses whose rate bends, through a wooden body
n = int(0.62 * SR); x = np.zeros(n); t = 0.0
while t < 0.6:
    k = t / 0.6; rate = 55 + 120 * np.sin(np.pi * k) + 25 * rng.standard_normal()
    i = int(t * SR)
    if i < n: x[i] += (0.6 + 0.4 * rng.random()) * np.sin(np.pi * k) ** 0.6
    t += 1 / max(rate, 30)
body = reson(x, 520, 9) + 0.6 * reson(x, 1180, 12) + 0.3 * reson(x, 2600, 14)
save(os.path.join(out, "creak.wav"), body * env(n, 0.04, 0.12), 0.7)

# the rustle: paper noise in two bands, crackling, swelling then gone
n = int(0.62 * SR); w = rng.standard_normal(n)
crack = np.zeros(n); idx = rng.choice(n, 90, replace=False); crack[idx] = rng.standard_normal(90) * 6
band = reson(w + crack, 3200, 1.2) * 0.8 + reson(w + crack, 1300, 1.5) * 0.5
mod = onepole(np.abs(rng.standard_normal(n)) ** 2, 0.002) * 3
save(os.path.join(out, "rustle.wav"), band * (0.4 + mod) * env(n, 0.05, 0.25), 0.7)

# the pencil: graphite on cotton paper, strokes at ~7 a second, grainy and dry
n = int(1.1 * SR); w = rng.standard_normal(n); tt = np.arange(n) / SR
strokes = 0.55 + 0.45 * np.abs(np.sin(2 * np.pi * 3.6 * tt + 0.8 * np.sin(2 * np.pi * 0.9 * tt)))
grain = (rng.random(n) < 0.02) * rng.standard_normal(n) * 3
hi = reson(w + grain, 4200, 0.9) + 0.5 * reson(w, 7000, 1.0)
save(os.path.join(out, "pencil.wav"), hi * strokes * env(n, 0.03, 0.12), 0.6)

# the dip pen: one word, a short scratch with two strokes
n = int(0.32 * SR); w = rng.standard_normal(n); tt = np.arange(n) / SR
strokes = np.clip(np.sin(2 * np.pi * 6.5 * tt), 0.15, 1)
save(os.path.join(out, "pen.wav"), (reson(w, 5200, 1.4) + 0.4 * reson(w, 2400, 2)) * strokes * env(n, 0.01, 0.08), 0.6)

# the tock: a small wood block
n = int(0.18 * SR); tt = np.arange(n) / SR
tock = np.sin(2 * np.pi * 880 * tt) * np.exp(-tt / 0.03) + 0.5 * np.sin(2 * np.pi * 2290 * tt) * np.exp(-tt / 0.012) + 0.2 * rng.standard_normal(n) * np.exp(-tt / 0.002)
save(os.path.join(out, "tock.wav"), tock, 0.7)

# the portrait line, cut at its sentence pauses (energy segments from voice/03-5.wav)
vdir = os.path.join(here, "..", "voice")
with wave.open(os.path.join(vdir, "03-5.wav")) as w:
    sr = w.getframerate(); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768
SEG = {"a": (0.160, 0.675), "b": (1.690, 2.740), "c": (3.735, 4.855), "d": (5.860, 6.865), "e": (7.870, 9.030), "f": (9.985, 11.765)}
for k, (s0, s1) in SEG.items():
    i0, i1 = int((s0 - 0.06) * sr), min(len(a), int((s1 + 0.12) * sr))
    seg = a[i0:i1].copy(); m = len(seg)
    fade_in, fade_out = int(0.01 * sr), int(0.06 * sr)
    seg[:fade_in] *= np.linspace(0, 1, fade_in); seg[-fade_out:] *= np.linspace(1, 0, fade_out)
    with wave.open(os.path.join(vdir, f"03-5{k}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((seg * 32767).astype("<i2").tobytes())
print("ok", sorted(os.listdir(out)))
