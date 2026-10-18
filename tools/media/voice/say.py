"""
A placeholder read of a film's line, with the time of every word.

  python3 say.py "<line>" <voice> <name>

The line is phrases split by " | " (a short breath, .32 s) or " || " (a
longer one, .6 s); a phrase may open with a rate for the voice, like
"{+8%}": people speed up when they ramble and slow down when they ask. Each
phrase is read on its own, its silence trimmed, and the phrases are set in
a row with the breaths between, so the pacing is a person's and not one
long even read. Then the read is made to sound like a phone heard it: a
high-pass and a low-pass where a phone mic rolls off, a little
compression, a touch of a small room.

Writes <name>.wav (16-bit mono 48 kHz, what sound.mjs mixes) and <name>.js
(window.TZ_VOICE[name] = { words: [seconds from the start of the read, one
per word of the line], end: when the last word ends }), which social.html
loads so the film's caption and the cuts after the read sit on the voice's
clock. Needs edge-tts and numpy (pip install edge-tts numpy) and ffmpeg.
`edge-tts --list-voices` lists the voices.
"""
import asyncio, json, os, re, subprocess, sys, tempfile
import numpy as np
import edge_tts

SR = 48000
line, voice, name = sys.argv[1], sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(__file__))

def decode(mp3):
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", mp3, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32)

def trim(a, thresh=0.012, keep=0.05):
    loud = np.where(np.abs(a) > thresh)[0]
    if not len(loud): return a, 0.0
    i0 = max(0, loud[0] - int(keep * SR)); i1 = min(len(a), loud[-1] + int(keep * SR))
    return a[i0:i1], i0 / SR

async def read(text, rate):
    com = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
    audio, words = bytearray(), []
    async for ch in com.stream():
        if ch["type"] == "audio": audio += ch["data"]
        elif ch["type"] == "WordBoundary": words.append((ch["offset"] / 1e7, ch["duration"] / 1e7, ch["text"]))
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f: f.write(audio); path = f.name
    a = decode(path); os.remove(path)
    return a, words

async def main():
    parts = re.split(r"\s*(\|\|?)\s*", line)
    out, words, at = [], [], 0.0
    gap_before = 0.0
    for p in parts:
        if p in ("|", "||"): gap_before = 0.6 if p == "||" else 0.32; continue
        m = re.match(r"^\{([+-]\d+%)\}\s*(.*)$", p); rate, text = (m.group(1), m.group(2)) if m else ("+0%", p)
        a, ws = await read(text, rate)
        a, lead = trim(a)
        if out: at += gap_before; out.append(np.zeros(int(gap_before * SR), np.float32))
        words += [(round(at + w[0] - lead, 2), w[1], w[2]) for w in ws]
        out.append(a); at += len(a) / SR
    raw = np.concatenate(out + [np.zeros(int(.25 * SR), np.float32)])
    raw_path = os.path.join(here, name + ".raw.wav"); wav = os.path.join(here, name + ".wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", raw_path], input=raw.tobytes(), check=True)
    # The phone's ear: a mic's roll-offs, a little compression, a small room.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw_path, "-af",
                    "highpass=f=120,lowpass=f=7600,acompressor=threshold=-20dB:ratio=2.2:attack=6:release=140:makeup=2,aecho=0.9:0.22:9:0.09,volume=0.95",
                    "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", wav], check=True)
    os.remove(raw_path)
    # Her level: the read peaks at -3 dBFS, so it sits over the film's bed and not under it.
    a = decode(wav); peak = float(np.max(np.abs(a))) or 1.0
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-sample_fmt", "s16", wav], input=(a * (0.708 / peak)).astype(np.float32).tobytes(), check=True)
    n = len(re.sub(r"\{[+-]\d+%\}\s*", "", re.sub(r"\s*\|\|?\s*", " ", line)).split(" "))
    if len(words) != n: print(f"warning: {len(words)} word times for {n} words in the line", file=sys.stderr)
    end = round(words[-1][0] + words[-1][1], 2) if words else 0
    js = f"window.TZ_VOICE = window.TZ_VOICE || {{}};\nwindow.TZ_VOICE[{json.dumps(name)}] = {{ voice: {json.dumps(voice)}, words: {json.dumps([w[0] for w in words])}, end: {end} }};\n"
    open(os.path.join(here, name + ".js"), "w").write(js)
    print(f"{name}.wav  {voice}  {len(words)} words  ends at {end}s")

asyncio.run(main())
