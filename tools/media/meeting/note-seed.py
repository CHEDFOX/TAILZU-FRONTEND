#!/usr/bin/env python3
"""
The note the Bleeped film opens on the Mac, for the desk's own page to draw:
ES2002a's words (AMI Meeting Corpus, CC BY 4.0) in turns, each labelled the
way the note-taker's Mac would label it. The project manager took the note,
so is "You"; the others are "Speaker 1" to "Speaker 3", in the order they
first speak. Writes ../desk-seed/note-seed.json, which film-note.ts reads,
and timeline.js beside this file: the whole meeting as each voice's stretches
of talk, for the film's "Tailzu already was." (window.TZ_MEETING_ALL).

    python3 tools/media/meeting/note-seed.py
"""
import json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cut import SRC, fetch, tokens  # noqa: E402
START, END = 50.4, 1109.5   # "Okay. Right." to "thank you all for coming"
LABEL = {"B": "You", "D": "Speaker 1", "A": "Speaker 2", "C": "Speaker 3"}
# Where in the meeting each of the note's seven lines was said (its seconds).
KEPT = [474.1,   # "selling this remote control for twenty five Euro"
        487.2,   # "we don't want it to cost any more than twelve fifty"
        509.3,   # "is that wholesale or retail?"
        794.5,   # "My parents went out and bought remote controls"
        914.7,   # "whistle or make a really high pitched noise they beep"
        985.5,   # "as the industrial designer, you're gonna be working on"
        1084.4]  # "one factor would be production cost"
ANIMALS = (151.8, 453.6)   # the corpus's topic "drawing animals on the whiteboard"


def main():
    fetch()
    T = tokens(zipfile.ZipFile(os.path.join(SRC, "ami_public_manual_1.6.2.zip")))
    turns = []
    for s in "ABCD":
        cur = None
        for x in (x for x in T if x["s"] == s and x["tag"] == "w"):
            if x["punc"]:
                if cur:
                    cur["text"] += x["w"]
                continue
            # A pause of more than 0.8 s, or forty words, and the next word starts a new turn.
            if cur and (x["t0"] - cur["end"] > .8 or len(cur["text"].split()) >= 40):
                turns.append(cur); cur = None
            if not cur:
                cur = dict(at=x["t0"], end=x["t1"], text=x["w"], speaker=LABEL[s])
            else:
                cur["text"] += " " + x["w"]; cur["end"] = x["t1"]
        if cur:
            turns.append(cur)
    turns.sort(key=lambda u: u["at"])
    segs = [dict(at=round(u["at"] - START, 2), text=u["text"], speaker=u["speaker"]) for u in turns if START - .5 <= u["at"] <= END + .5]
    words = sum(len(s["text"].split()) for s in segs)
    out = os.path.normpath(os.path.join(HERE, "..", "desk-seed", "note-seed.json"))
    with open(out, "w") as f:
        json.dump(dict(segments=segs, words=words, duration=round(END - START)), f)
    print(f"{out}: {len(segs)} turns, {words} words")

    # Each voice's stretches of talk: its words, joined across pauses under 0.6 s.
    lanes = {}
    for sp in "ABCD":
        runs = []
        for x in (x for x in T if x["s"] == sp and x["tag"] == "w" and not x["punc"] and START - .5 <= x["t0"] <= END + .5):
            if runs and x["t0"] - runs[-1][1] < .6:
                runs[-1][1] = max(runs[-1][1], x["t1"])
            else:
                runs.append([x["t0"], x["t1"]])
        lanes[sp] = [[round(a, 2), round(b, 2)] for a, b in runs]
    order = sorted(lanes, key=lambda sp: -sum(b - a for a, b in lanes[sp]))
    turns = sum(1 for i, g in enumerate(segs) if i == 0 or g["speaker"] != segs[i - 1]["speaker"])
    data = dict(start=START, end=END, order=order, lanes=lanes, animals=ANIMALS, kept=KEPT,
                words=words, turns=turns, questions=sum(g["text"].count("?") for g in segs))
    with open(os.path.join(HERE, "timeline.js"), "w") as f:
        f.write("// Written by meeting/note-seed.py: AMI meeting ES2002a (CC BY 4.0), every stretch of talk by voice.\n")
        f.write("window.TZ_MEETING_ALL = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print(f"timeline.js: {sum(len(v) for v in lanes.values())} stretches, order {order}, {turns} turns, {data['questions']} questions")


if __name__ == "__main__":
    main()
