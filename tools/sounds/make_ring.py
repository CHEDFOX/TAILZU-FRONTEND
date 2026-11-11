"""
X0's ringtone, made from nothing but sine waves (no samples, no copy of any phone's tone).

    python3 tools/sounds/make_ring.py app/assets/sounds/x0_ring_1.wav

A ring is two little "bip-bip-bwee" phrases, a question and its answer, then a rest; eight rings make 20 seconds. Each note is a
bot's blip: it starts a few semitones high and drops onto its pitch in 20 ms, with a soft second and third harmonic. The long note
of each phrase lifts by a tone with a gentle vibrato, so it sounds like asking "are you there?". It fades in over the first
second, has a short room echo for warmth, and is set to a -3 dBFS peak. 22,050 Hz, 16-bit, mono WAV: what iOS plays as a
notification sound (at most 30 s), and what a later store build can put in Android's res/raw as is.
"""
import sys
import wave

import numpy as np

SR = 22050
SECONDS = 20.0
CYCLE = 2.5          # one ring: two phrases, then a rest
PEAK_DBFS = -3.0


def semis(f, s):
    return f * 2.0 ** (s / 12.0)


def note(f0, dur, *, chirp=4.0, chirp_ms=20.0, glide_to=None, vibrato=0.0, decay=None):
    """One blip: starts `chirp` semitones high, falls to f0 in chirp_ms; optionally glides to glide_to over the note."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    c = np.clip(t / (chirp_ms / 1000.0), 0.0, 1.0)
    f = semis(f0, chirp * (1.0 - c) ** 2)                      # the blip's fall
    if glide_to is not None:
        g = np.clip((t - 0.04) / max(dur - 0.08, 1e-3), 0.0, 1.0)
        f = f * (glide_to / f0) ** (g * g * (3 - 2 * g))       # a smooth lift
    if vibrato:
        f = f * 2.0 ** ((vibrato / 1200.0) * np.sin(2 * np.pi * 7.0 * t) * np.clip((t - 0.08) / 0.1, 0, 1))
    phase = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(phase) + 0.25 * np.sin(2 * phase) + 0.08 * np.sin(3 * phase)
    attack = np.clip(t / 0.006, 0.0, 1.0)
    attack = 0.5 - 0.5 * np.cos(np.pi * attack)
    if decay:                                                  # short notes ring out
        env = attack * np.exp(-t / decay)
    else:                                                      # long notes hold, then let go over 80 ms
        rel = np.clip((dur - t) / 0.08, 0.0, 1.0)
        env = attack * (0.85 + 0.15 * np.exp(-t / 0.12)) * (0.5 - 0.5 * np.cos(np.pi * rel))
    return y * env


def place(buf, at, y):
    i = int(at * SR)
    j = min(len(buf), i + len(y))
    buf[i:j] += y[: j - i]


E5, GS5, A5, B5, CS6 = 659.26, 830.61, 880.00, 987.77, 1108.73

out = np.zeros(int(SECONDS * SR))
for k in range(int(SECONDS / CYCLE)):
    t0 = k * CYCLE
    # the question: bip, bip, bwee (B5 lifting to C#6)
    place(out, t0 + 0.00, note(E5, 0.09, decay=0.055))
    place(out, t0 + 0.12, note(E5, 0.09, decay=0.055))
    place(out, t0 + 0.24, 0.9 * note(B5, 0.32, glide_to=CS6, vibrato=15))
    # the answer: bip, bip, bwoo (G#5 settling on A5)
    place(out, t0 + 0.75, note(E5, 0.09, decay=0.055))
    place(out, t0 + 0.87, note(E5, 0.09, decay=0.055))
    place(out, t0 + 0.99, 0.9 * note(GS5, 0.36, glide_to=A5, vibrato=12))
    # then 1.15 s of rest

# a little room: two soft reflections
room = out.copy()
for delay, gain in ((0.035, 0.18), (0.071, 0.08)):
    d = int(delay * SR)
    room[d:] += gain * out[:-d]
out = room

# fade in over the first second (from a third of full), and end on silence
t = np.arange(len(out)) / SR
out *= np.where(t < 1.0, 0.35 + 0.65 * (0.5 - 0.5 * np.cos(np.pi * t)), 1.0)
out[-int(0.05 * SR):] = 0.0

out *= (10 ** (PEAK_DBFS / 20.0)) / np.max(np.abs(out))
pcm = np.round(out * 32767).astype("<i2")

path = sys.argv[1] if len(sys.argv) > 1 else "x0_ring_1.wav"
with wave.open(path, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"{path}: {len(pcm) / SR:.2f} s, peak {20 * np.log10(np.max(np.abs(pcm)) / 32767):.2f} dBFS, {44 + pcm.nbytes} bytes")
