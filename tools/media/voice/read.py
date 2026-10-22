"""
A film's line, read by a voice that is no one's: the reads the films use.

  python read.py <name> [out.wav]       e.g. python read.py hands

Each line (LINES) is read by Chatterbox Turbo (Resemble AI, MIT), cloning a
reference voice made by Kokoro (hexgrad, Apache-2.0) from one of its Hindi
voices reading a Hindi sentence, so the read has an Indian English accent and
is not a copy of any real person. Chatterbox marks what it makes with an
inaudible watermark (Perth). The seed is the take that was kept: the same
seed gives the same read. Then scene.py puts it in its room and times its words.

Runs on a CPU (about 1.5x real time on four cores). Needs:
  pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
  pip install chatterbox-tts kokoro soundfile          (Python 3.11)
"""
import os, sys, tempfile
import numpy as np, soundfile as sf, torch, torchaudio as ta

REF = "मैं सोच रहा था कि हम छह बजे निकलें, रास्ते में कुछ खा लें, और ट्रैफिक बढ़ने से पहले पहुँच जाएँ। तुम्हें क्या लगता है?"
LINES = {
    "hands": ("hm_omega", 1, "Okay, umm... put Aarav's parent-teacher meeting on Thursday at five. And remind me to pay the electricity bill, Friday morning."),
    "downloads": ("hf_alpha", 2, "[sigh] Clean up my Downloads. Invoices in one folder, screenshots in another... and bin the duplicates."),
    "due": ("hf_beta", 1, "Okay wait... what all do I have to submit this week? Just put it all in my tasks."),
    "pay": ("hm_psi", 3, "Send four fifty to Rohan for dinner. His UPI is rohan m, at ok axis."),
}
name = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else f"{name}-read.wav"
voice, seed, text = LINES[name]
torch.set_num_threads(os.cpu_count() or 4)
from kokoro import KPipeline
ref = os.path.join(tempfile.gettempdir(), f"ref-{voice}.wav")
sf.write(ref, np.concatenate([x.audio.numpy() for x in KPipeline(lang_code="h")(REF, voice=voice)]), 24000)
from chatterbox.tts_turbo import ChatterboxTurboTTS
m = ChatterboxTurboTTS.from_pretrained(device="cpu"); m.prepare_conditionals(ref)
torch.manual_seed(seed); w = m.generate(text, temperature=0.8)
ta.save(out, w, m.sr); print(out, round(w.shape[-1] / m.sr, 2), "s")
