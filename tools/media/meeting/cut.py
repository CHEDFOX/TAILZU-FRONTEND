#!/usr/bin/env python3
"""
THE MEETING, BLEEPED. The soundtrack of the "Bleeped" film, cut from a real
meeting: AMI meeting ES2002a, a design team's kick-off, recorded in 2004 for
the AMI Meeting Corpus (CC BY 4.0). Its four headset microphones are mixed
again, each voice gated to when that person speaks and brought to one level;
the off-topic words are replaced by a 1 kHz bleep; the rest is cut tight.

    python3 tools/media/meeting/cut.py

Writes, beside this file:
  bleeped.wav  the track, 48 kHz, 16-bit, mono
  bleeped.js   window.TZ_MEETING: every word heard, its time in the track,
               who said it and whether it was bleeped; the bleeps; where in
               the meeting each piece of the track comes from

The sources are downloaded into src/ (gitignored) the first time: the four
headsets of ES2002a and the corpus's manual annotations, whose words carry
their times. Nothing but numpy is needed.
"""
import html, json, os, re, urllib.request, wave, zipfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
AMI = "https://groups.inf.ed.ac.uk/ami"
SOURCES = {f"ES2002a.Headset-{i}.wav": f"{AMI}/AMICorpusMirror/amicorpus/ES2002a/audio/ES2002a.Headset-{i}.wav" for i in range(4)}
SOURCES["ami_public_manual_1.6.2.zip"] = f"{AMI}/AMICorpusAnnotations/ami_public_manual_1.6.2.zip"

# Who is who (corpusResources/meetings.xml): the agent, the headset it wore, its role.
SPEAKERS = {"A": (0, "Industrial designer"), "B": (1, "Project manager"), "C": (2, "Interface designer"), "D": (3, "Marketing")}

SR, OUT = 16000, 48000
# The track, in order. Each clip is pieces of the meeting: (silence before,
# from, to[, only these voices[, dB]]) in seconds of ES2002a. `bleep` is [from, to)
# in the meeting's seconds; a bleep with "stop" winds down like a tape
# stopping, for `tail` seconds past the piece. `who` is whose words are
# captioned; `mute` a voice for a moment (someone talking under the line);
# `laughs` the ones the annotation folds into a word; `fix` a word as the
# caption writes it, by its start (a capital, a comma, a hyphen, a start the
# annotation has a little early).
CLIPS = [
    # Cold open. "Is that a [whale]?" "Yeah." The project manager laughs.
    dict(id="whale", pieces=[(.12, 311.98, 314.72)], bleep=[(312.31, 312.84)], who="BA", mute=[("A", 311.9, 312.95)],
         laughs=[("B", 313.60, 314.65)], fix={312.33: dict(p="?")}),
    # "My favourite animal is like... a [beagle]." The project manager laughs.
    dict(id="beagle", pieces=[(.5, 187.44, 188.24), (.16, 189.98, 191.58), (.42, 203.42, 204.25), (.02, 205.25, 206.35, "B")], bleep=[(203.55, 204.15)], who="DB",
         fix={191.07: dict(p="…"), 203.45: dict(w="a")}),
    # "When [planet of the apes] becomes real."
    dict(id="apes", pieces=[(.3, 270.52, 271.93)], bleep=[(270.69, 271.20)], who="C", fix={270.53: dict(w="When"), 271.48: dict(p=".")}),
    # "He looks more like a [pig], actually." (The project manager's dog.)
    dict(id="pig", pieces=[(.3, 373.30, 374.74)], bleep=[(373.99, 374.35)], who="B"),
    # "He chases his [tail]." A laughs.
    dict(id="tail", pieces=[(.22, 428.39, 429.30), (.06, 429.62, 430.30, "A", -6)], bleep=[(428.95, 429.30)], who="BA", fix={428.39: dict(w="He"), 428.94: dict(p=".")}),
    # "Is he aware that it's his own [tail]–" The bleep runs down on him.
    dict(id="aware", pieces=[(.16, 431.26, 431.86, "D"), (.03, 431.89, 432.62, "D")], bleep=[(432.32, 432.62, "stop")], tail=.62, who="D",
         fix={431.90: dict(w="it's"), 432.30: dict(w="tail", p="—")}),
    # Seven minutes in, the point, cut clean of its ums.
    dict(id="point", pieces=[(.62, 474.10, 476.60, "B"), (.3, 487.20, 487.70, "B"), (.03, 488.09, 490.42, "B"), (.05, 490.79, 491.85, "B")], who="B",
         fix={474.11: dict(w="We're"), 476.23: dict(p="."), 491.41: dict(p=".")}),
    dict(id="again", pieces=[(.4, 496.02, 497.66)], who="D"),
    dict(id="down", pieces=[(.55, 621.06, 622.72)], who="B", fix={622.33: dict(p=".")}),
]
ROOM = (206.45, 209.65)    # a stretch nobody speaks in, for the silences
LEVEL = 10 ** (-22 / 20)   # each voice's speaking level (RMS)
SPEECH = 10 ** (-20 / 20)  # each clip's words, brought to one level (RMS)
BLEEP = .125               # the bleep's amplitude: a touch under the words


def fetch():
    os.makedirs(SRC, exist_ok=True)
    for name, url in SOURCES.items():
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print("downloading", url)
            urllib.request.urlretrieve(url, p + ".part")
            os.replace(p + ".part", p)


def load(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2 and w.getnchannels() == 1, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768


def tokens(z):
    """Every word, laugh and the rest of ES2002a, each with its speaker and times."""
    out = []
    for s in "ABCD":
        x = z.read(f"words/ES2002a.{s}.words.xml").decode("latin-1")
        for m in re.finditer(r'<(w|vocalsound|disfmarker|pause|nonvocalsound|gap)\b([^>]*?)(?:/>|>(.*?)</\1>)', x, re.S):
            tag, attrs, body = m.groups()
            a = dict(re.findall(r'([\w:]+)="([^"]*)"', attrs))
            if "starttime" not in a or "endtime" not in a:
                continue
            out.append(dict(s=s, tag=tag, t0=float(a["starttime"]), t1=float(a["endtime"]),
                            w=html.unescape(body or a.get("type", "")), punc=a.get("punc") == "true"))
    return sorted(out, key=lambda x: (x["t0"], x["t1"]))


def gate(x, spans, pre=.06, post=.15, floor=.1, ramp=.025):
    """A voice's headset, open while that person speaks or laughs, a twentieth as loud otherwise."""
    g = np.full(len(x), floor)
    for t0, t1 in spans:
        a, b = int((t0 - pre) * SR), int((t1 + post) * SR)
        g[max(0, a):max(0, b)] = 1
    k = int(ramp * SR)
    g = np.convolve(g, np.ones(k) / k, mode="same")
    return x * g


def limit(x, thr=10 ** (-4 / 20), look=.004, release=.08):
    """A peak limiter: the gain is down before a laugh's burst arrives, and comes back over 80 ms."""
    k = int(look * SR); a = np.abs(x)
    env = np.lib.stride_tricks.sliding_window_view(np.pad(a, (0, k - 1)), k).max(axis=1)
    want = np.minimum(1, thr / np.maximum(env, 1e-9))
    g = np.empty_like(want); cur = 1.0; r = np.exp(-1 / (release * SR))
    for i, w in enumerate(want):
        cur = w if w < cur else w + (cur - w) * r
        g[i] = cur
    return x * g


def up3(x):
    """16 kHz to 48 kHz: zeros between, then a windowed-sinc low-pass at 7.6 kHz."""
    y = np.zeros(len(x) * 3); y[::3] = x * 3
    n = np.arange(-120, 121); fc = 7600 / OUT
    h = 2 * fc * np.sinc(2 * fc * n) * np.blackman(len(n))
    return np.convolve(y, h, mode="same")


def fade(n, k):
    e = np.ones(n); k = min(k, n // 2)
    if k: r = .5 - .5 * np.cos(np.linspace(0, np.pi, k)); e[:k] *= r; e[-k:] *= r[::-1]
    return e


def main():
    fetch()
    z = zipfile.ZipFile(os.path.join(SRC, "ami_public_manual_1.6.2.zip"))
    T = tokens(z)
    heads = {s: load(os.path.join(SRC, f"ES2002a.Headset-{i}.wav")) for s, (i, _) in SPEAKERS.items()}

    # Each voice gated to itself and brought to one level; summed per piece.
    voice = {}
    for s, x in heads.items():
        spans = [(t["t0"], t["t1"]) for t in T if t["s"] == s and t["tag"] in ("w", "vocalsound") and t["t1"] > t["t0"]]
        x = gate(x, spans)
        talk = np.concatenate([x[int(a * SR):int(b * SR)] for a, b in spans if b - a > .15])
        voice[s] = x * LEVEL / np.sqrt(np.mean(talk ** 2))
        print(f"{s}  gain {20 * np.log10(LEVEL / np.sqrt(np.mean(talk ** 2)) + 1e-12):+.1f} dB  ({SPEAKERS[s][1]})")

    # The pieces laid end to end, on the room's own quiet.
    room = sum(v[int(ROOM[0] * SR):int(ROOM[1] * SR)] for v in voice.values())
    pieces, bleeps, words, clips = [], [], [], []
    t = 0.0
    for c in CLIPS:
        c0 = None
        for gap, a, b, *more in c["pieces"]:
            t += gap
            c0 = t if c0 is None else c0
            pieces.append(dict(at=round(t, 4), src=a, to=b, only=more[0] if more else "ABCD", db=more[1] if len(more) > 1 else 0, mute=c.get("mute", [])))
            t += b - a
        stop = c.get("tail", 0)
        clips.append(dict(id=c["id"], at=round(c0, 3), end=round(t + stop, 3)))
        for bl in c.get("bleep", []):
            a, b = bl[0], bl[1]
            for p in pieces[-len(c["pieces"]):]:
                if p["src"] <= a < p["to"]:
                    o = p["at"] + a - p["src"]
                    bleeps.append(dict(at=round(o, 3), end=round(o + (b - a), 3), stop=len(bl) > 2, tail=stop if len(bl) > 2 else 0, clip=c["id"]))
        t += stop
        # The caption: the words of the clip's speakers, in the track's time.
        for p in pieces[-len(c["pieces"]):]:
            for tok in T:
                fx = next((v for k, v in c.get("fix", {}).items() if abs(tok["t0"] - k) < .005), {})
                if fx.get("skip"):
                    continue
                if "t0" in fx:
                    tok = dict(tok, t0=fx["t0"])
                # A word is in the piece when its middle is, or it starts well inside it.
                inside = p["src"] <= (tok["t0"] + tok["t1"]) / 2 < p["to"] or p["src"] <= tok["t0"] < p["to"] - .12
                if tok["s"] not in c["who"] or tok["s"] not in p["only"] or not inside:
                    continue
                if any(m[0] == tok["s"] and m[1] <= tok["t0"] < m[2] for m in p["mute"]):
                    continue
                o0, o1 = p["at"] + max(tok["t0"], p["src"]) - p["src"], p["at"] + min(tok["t1"], p["to"]) - p["src"]
                if tok["tag"] == "w" and tok["punc"]:
                    own = [w for w in words if w["clip"] == c["id"] and w["s"] == tok["s"] and not w.get("laugh")]
                    if own and "p" not in own[-1]:
                        own[-1]["p"] = own[-1].get("p", "") + tok["w"]
                    continue
                if tok["tag"] == "vocalsound" and tok["w"] == "laugh":
                    words.append(dict(t=round(o0, 3), e=round(o1, 3), w="(laughs)", s=tok["s"], clip=c["id"], laugh=True))
                elif tok["tag"] == "w":
                    # Bleeped: the word starts under a bleep, or half of it is under one.
                    hit = any((bl["at"] - .05 <= o0 < bl["end"] - .15) or (min(o1, bl["end"]) - max(o0, bl["at"]) > .5 * max(o1 - o0, .05))
                              for bl in bleeps if bl["clip"] == c["id"])
                    words.append(dict(t=round(o0, 3), e=round(o1, 3), w=fx.get("w", tok["w"]), s=tok["s"], clip=c["id"], **({"bleep": True} if hit else {}), **({"p": fx["p"]} if "p" in fx else {})))
            for s0, a, b in c.get("laughs", []):
                if p["src"] <= a < p["to"]:
                    words.append(dict(t=round(p["at"] + a - p["src"], 3), e=round(p["at"] + min(b, p["to"]) - p["src"], 3), w="(laughs)", s=s0, clip=c["id"], laugh=True))
        words.sort(key=lambda w: w["t"])
    end = t + .4

    # Built at 16 kHz, lifted to 48 kHz; then the bleeps, at 48 kHz.
    n = int(end * SR)
    track = np.resize(room, n) * .8
    for p in pieces:
        a, b = int(p["src"] * SR), int(p["to"] * SR)
        seg = 0
        for s, v in voice.items():
            if s not in p["only"]:
                continue
            m = np.ones(b - a)
            for who, m0, m1 in p["mute"]:
                if who == s:
                    i0, i1 = max(0, int((m0 - p["src"]) * SR)), max(0, int((m1 - p["src"]) * SR))
                    m[i0:i1] = 0
            seg = seg + v[a:b] * np.convolve(m, np.ones(160) / 160, mode="same")
        seg = seg * fade(b - a, int(.012 * SR)) * 10 ** (p["db"] / 20)
        i = int(p["at"] * SR)
        track[i:i + len(seg)] = track[i:i + len(seg)] * (1 - fade(len(seg), int(.012 * SR))) + seg
    # Each clip's words at one level, whoever said them and however softly.
    for c in clips:
        ws = [w for w in words if w["clip"] == c["id"] and not w.get("laugh") and not w.get("bleep")]
        talk = np.concatenate([track[int(w["t"] * SR):int(w["e"] * SR)] for w in ws])
        g = SPEECH / np.sqrt(np.mean(talk ** 2))
        a, b = int(c["at"] * SR), int(c["end"] * SR)
        track[a:b] *= g
        c["gain"] = round(20 * np.log10(g), 1)
    y = up3(limit(track))
    for bl in bleeps:
        a, b = int(bl["at"] * OUT), int((bl["end"] + bl["tail"]) * OUT)
        y[a:b] *= 1 - fade(b - a, int(.006 * OUT))     # the word, gone
        k = np.arange(b - a) / OUT
        if bl["stop"]:
            # The tape stopping: the pitch falls away and the level with it.
            d = bl["end"] - bl["at"]; r = np.where(k < d, 1.0, np.clip(1 - (k - d) / bl["tail"], 0, 1) ** 1.6)
            ph = 2 * np.pi * np.cumsum(1000 * np.maximum(r, .04)) / OUT
            tone = np.sin(ph) * BLEEP * np.where(k < d, 1, np.clip(1 - (k - d) / bl["tail"], 0, 1) ** .5)
        else:
            tone = np.sin(2 * np.pi * 1000 * k) * BLEEP
        y[a:b] += tone * fade(b - a, int(.004 * OUT))
    y *= min(1, 10 ** (-1.5 / 20) / np.max(np.abs(y)))

    with wave.open(os.path.join(HERE, "bleeped.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(OUT)
        w.writeframes((np.clip(y, -1, 1) * 32767).round().astype("<i2").tobytes())
    pieces = [dict(at=p["at"], src=p["src"], to=p["to"]) for p in pieces]
    gains = {c["id"]: c["gain"] for c in clips}
    clips = [{k: v for k, v in c.items() if k != "gain"} for c in clips]
    data = dict(dur=round(len(y) / OUT, 3), roles={s: r for s, (_, r) in SPEAKERS.items()}, clips=clips, pieces=pieces, bleeps=bleeps, words=words)
    with open(os.path.join(HERE, "bleeped.js"), "w") as f:
        f.write("// Written by meeting/cut.py: the words of the Bleeped film's track, on its clock. AMI meeting ES2002a, CC BY 4.0.\n")
        f.write("window.TZ_MEETING = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print(f"bleeped.wav  {len(y) / OUT:.2f} s, {len(bleeps)} bleeps, {len(words)} words")
    for c in clips:
        line = " ".join((("█" * len(w["w"])) if w.get("bleep") else w["w"]) + w.get("p", "") for w in words if w["clip"] == c["id"])
        print(f"  {c['at']:6.2f}–{c['end']:6.2f}  {c['id']:7} {line}")
    print("clip gains (dB):", gains)


if __name__ == "__main__":
    main()
