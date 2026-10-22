"""
A dictation as it would be heard in the room it was said in, its words timed,
and the room itself.

  python scene.py <read.wav> <name> <room> <seconds> "<what was said>" [babble.wav]

<read.wav> is the voice as the text-to-speech model gave it (see README.md:
Chatterbox Turbo, cloning a Kokoro voice, so no real person's voice is used).
It is trimmed, high-passed, put in a small room (a synthetic impulse
response), gently compressed and levelled, and written as <name>.wav. The
words are found by Whisper and lined up with the caption's words, written as
<name>.js (window.TZ_VOICE[name] = { words: [seconds from the start of
<name>.wav, one per word of the caption], end }), which social.html loads.

<room> is where it was said, written as <name>-room.wav, <seconds> long, for
the film to lay under its scene from the first frame:
  kitchen     a pan frying, a chimney fan
  study       room tone, a ceiling fan
  night       room tone, a ceiling fan, crickets outside
  restaurant  chatter (babble.wav: many voices overlapped, made by
              babble.py), cutlery, the air conditioning

Everything is mono 16-bit PCM, the voice at 48 kHz and the room at 24 kHz
(sound.mjs resamples). Needs numpy,
scipy, soundfile, librosa and faster-whisper.
"""
import json, os, re, sys
from difflib import SequenceMatcher
import numpy as np, soundfile as sf, librosa
from scipy.signal import butter, sosfilt, fftconvolve

SR = 48000
src, name, room, seconds, said = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
babble = sys.argv[6] if len(sys.argv) > 6 else None
here = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(sum(map(ord, name)))

def bp(x, lo=None, hi=None, order=2):
    if lo and hi: sos = butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    elif lo: sos = butter(order, lo, "highpass", fs=SR, output="sos")
    else: sos = butter(order, hi, "lowpass", fs=SR, output="sos")
    return sosfilt(sos, x)
def smooth_noise(n, rate):
    """Noise that wanders at about `rate` Hz, in [0, 1]."""
    k = max(2, int(n / SR * rate) + 2); pts = rng.random(k)
    return np.interp(np.linspace(0, k - 1, n), np.arange(k), pts)
def room_ir(rt60=.32, size=1.0):
    n = int(SR * rt60 * 1.2); t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt60); tail = bp(tail, 200, 6000)
    ir = np.zeros(n); ir[0] = 1
    for d, g in [(.0031, .5), (.0057, .38), (.0089, .3), (.0124, .24), (.0171, .19), (.0236, .14)]: ir[int(d * size * SR)] += g * rng.choice([-1, 1])
    ir += tail * .05; return ir / np.abs(ir).max()
def level(x, peak=.7): return x * (peak / max(1e-9, np.abs(x).max()))
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
def at_db(x, db): return x * 10 ** ((db - rms_db(x)) / 20)

# ---- the voice ------------------------------------------------------------------------
v, _ = librosa.load(src, sr=SR, mono=True)
loud = np.where(np.abs(v) > .02)[0]; v = v[max(0, loud[0] - int(.06 * SR)): loud[-1] + int(.25 * SR)]
v = bp(v, lo=90); dry = v
wet = fftconvolve(v, room_ir(.3 if room != "restaurant" else .45, 1.4 if room == "restaurant" else 1))[: len(v)]
v = dry + .16 * level(wet, np.abs(dry).max())
env = np.sqrt(np.convolve(v ** 2, np.ones(int(.02 * SR)) / int(.02 * SR), "same")) + 1e-6
thr = np.percentile(env, 90) * .5; gain = np.where(env > thr, (thr / env) ** .35, 1); v = v * np.convolve(gain, np.ones(480) / 480, "same")
v = level(bp(v, hi=12000), .72)
sf.write(os.path.join(here, f"{name}.wav"), v, SR, subtype="PCM_16")

# ---- the words, on the voice's clock --------------------------------------------------
from faster_whisper import WhisperModel
NUM = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "450": "four fifty"}
def norm(w): w = re.sub(r"[^a-z0-9]", "", w.lower()); return NUM.get(w, w)
segs, _ = WhisperModel("small.en", device="cpu", compute_type="int8").transcribe(librosa.resample(v, orig_sr=SR, target_sr=16000), language="en", word_timestamps=True, beam_size=5)
heard = []
for s in segs:
    for w in s.words:
        for part in norm(w.word).split() or [""]: heard.append((part, w.start, w.end))
cap = said.split(); want = [norm(w) for w in cap]
times = [None] * len(cap)
for a, b, n in SequenceMatcher(None, want, [h[0] for h in heard], autojunk=False).get_matching_blocks():
    for i in range(n): times[a + i] = heard[b + i][1]
known = [i for i, x in enumerate(times) if x is not None]
first = heard[0][1] if heard else 0.0
for i in range(len(cap)):
    if times[i] is None:
        lo = max([k for k in known if k < i], default=None); hi = min([k for k in known if k > i], default=None)
        t0 = times[lo] if lo is not None else first; t1 = times[hi] if hi is not None else (heard[-1][2] if heard else t0 + .3)
        i0 = lo if lo is not None else -1; i1 = hi if hi is not None else len(cap)
        times[i] = t0 + (t1 - t0) * (i - i0) / (i1 - i0)
for i in range(1, len(times)): times[i] = max(times[i], times[i - 1] + .04)
end = heard[-1][2] if heard else len(v) / SR
with open(os.path.join(here, f"{name}.js"), "w") as f:
    f.write("window.TZ_VOICE = window.TZ_VOICE || {};\n")
    f.write(f"window.TZ_VOICE[{json.dumps(name)}] = {json.dumps({'said': said, 'words': [round(x, 2) for x in times], 'end': round(end, 2), 'matched': len(known), 'of': len(cap)})};\n")
print(f"{name}.wav {len(v) / SR:.2f}s  words matched {len(known)}/{len(cap)}  end {end:.2f}s")

# ---- the room ------------------------------------------------------------------------
n = int(seconds * SR)
def fan(): return at_db(bp(rng.standard_normal(n), hi=380) * (1 + .12 * np.sin(2 * np.pi * 4.3 * np.arange(n) / SR)), -46)
def tone(): return at_db(bp(np.cumsum(rng.standard_normal(n)) * .02, lo=40, hi=4000), -54)
amb = tone() + fan()
if room == "kitchen":
    fry = bp(rng.standard_normal(n), 1800, 9000) * (.55 + .45 * smooth_noise(n, 3))
    pops = np.zeros(n); k = rng.poisson(28 * seconds)
    for at in rng.integers(0, n - 2000, k):
        L = int(rng.uniform(.002, .009) * SR); burst = rng.standard_normal(L) * np.exp(-np.arange(L) / (L / 4)) * min(rng.pareto(2.2), 3)
        pops[at: at + L] += burst
    pops = bp(pops, lo=1200)
    chimney = at_db(bp(rng.standard_normal(n), 60, 900) + .2 * np.sin(2 * np.pi * 100 * np.arange(n) / SR), -38)
    amb += at_db(fry, -36) + at_db(pops, -40) + chimney
elif room == "night":
    t = np.arange(n) / SR; cr = np.zeros(n)
    for f0, period, off, g in [(4300, 1.3, .2, 1), (4720, 1.7, .9, .6)]:
        train = ((t - off) % period) < .42; pulse = (np.sin(2 * np.pi * 32 * t) > .2)
        cr += g * np.sin(2 * np.pi * f0 * t) * train * pulse
    amb += at_db(bp(cr, 3000, 6000), -47)
elif room == "restaurant":
    b, _ = librosa.load(babble, sr=SR, mono=True); b = np.tile(b, int(np.ceil(n / len(b))))[:n]
    b = bp(b, 150, 3800); b = b + .5 * fftconvolve(b, room_ir(.9, 3))[:n]
    clinks = np.zeros(n)
    for at in rng.integers(0, n - SR // 2, int(seconds / 1.4)):
        L = int(.25 * SR); tt = np.arange(L) / SR; base = rng.uniform(2200, 3400)
        clinks[at: at + L] += sum(np.sin(2 * np.pi * base * r * tt) * np.exp(-tt / d) for r, d in [(1, .09), (1.47, .06), (2.31, .04)]) * rng.uniform(.3, 1)
    amb += at_db(b, -31) + at_db(clinks, -43) + at_db(bp(rng.standard_normal(n), hi=250), -44)
# A room is under the voice, never over it: its loudest moment held to -12 dB.
lim = 10 ** (-12 / 20); amb = np.tanh(amb / lim) * lim
fade = np.minimum(1, np.minimum(np.arange(n) / (.4 * SR), (n - np.arange(n)) / (.8 * SR)))
# Written at 24 kHz: nothing in a room is above 12 kHz that matters, and it halves the file.
sf.write(os.path.join(here, f"{name}-room.wav"), librosa.resample(np.clip(amb * fade, -1, 1), orig_sr=SR, target_sr=24000), 24000, subtype="PCM_16")
print(f"{name}-room.wav {seconds:.1f}s  {room}  rms {rms_db(amb):.1f} dB")
