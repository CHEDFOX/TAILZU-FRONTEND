"""Restaurant chatter for scene.py: many short sentences in different Kokoro voices (Apache-2.0), overlapped. python babble.py writes babble24.wav."""
import numpy as np, soundfile as sf, torch, random
torch.set_num_threads(4)
from kokoro import KPipeline
en = KPipeline(lang_code='a'); br = KPipeline(lang_code='b')
lines = ["No, no, you have to try the dal here, it's honestly the best.", "Did you see what he posted last night?", "We should do this more often, yaar.",
 "I'll have another one of those, please.", "Wait, who's paying for the drinks?", "That's what I told her, but she didn't listen.", "Can we get the bill in a bit?",
 "The traffic was insane on the way here.", "So then he goes, okay fine, let's just do it.", "This is so good, oh my god.", "Are we splitting it four ways?",
 "I haven't been here since college.", "Excuse me, could we get some water?", "No way, are you serious?", "Let's take a picture before it gets cold."]
voices = [("a","af_heart"),("a","am_michael"),("a","af_bella"),("a","am_puck"),("b","bf_emma"),("b","bm_george"),("a","af_nicole"),("a","am_adam"),("b","bf_isabella"),("a","af_sarah")]
random.seed(4); out = np.zeros(int(24000 * 30))
for i, ln in enumerate(lines * 2):
    lc, v = random.choice(voices); p = en if lc == "a" else br
    a = np.concatenate([x.audio.numpy() for x in p(ln, voice=v, speed=random.uniform(.95, 1.15))])
    at = int(random.uniform(0, 28.5) * 24000); seg = a[: len(out) - at] * random.uniform(.25, .6)
    out[at: at + len(seg)] += seg
sf.write("babble24.wav", out / np.abs(out).max() * .7, 24000); print("ok")
