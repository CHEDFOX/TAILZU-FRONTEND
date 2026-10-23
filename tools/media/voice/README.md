# Voices

Recordings a film plays, as 16-bit PCM WAV, mono, 48 kHz. A film's cues
name one with `{ at, kind: "sample", file: "voice/<name>.wav", gain }`,
and sound.mjs mixes it in at `at`. Beside each WAV, `<name>.js` carries
the time of every word of the line (written by say.py), which social.html
loads so the caption and the cuts after the read sit on the voice's clock.

- `to-him.wav` — the dictation in the "to him" film. A placeholder read
  by a neural text-to-speech voice (Microsoft "Ava", multilingual) so the
  words are on a real clock. The name is spelled "Telzu" in the line given
  to the voice so it says tel-zu; the caption spells it Tailzu. Replace it
  with a real recording of the same line and re-run say.py, or write the
  word times by hand into to-him.js.

## The reads in the connected-app films

`hands`, `downloads`, `due` and `pay` are the lines said in the films of
the same names. They are not stock text-to-speech voices and not anyone's
voice: `read.py` has Chatterbox Turbo (MIT) clone a voice Kokoro
(Apache-2.0) made, which gives an Indian English read with breath and
hesitation in it. `scene.py` then puts each read in the room it was said
in: trimmed, a small room's reflections, gently compressed, its words timed
by Whisper into `<name>.js`. It also writes `<name>-room.wav`, the room
itself, which the film lays under its scene from the first frame:

| read | who | room |
|---|---|---|
| `hands` | a mother cooking | a pan frying, a chimney fan |
| `downloads` | at her Mac | room tone, a ceiling fan |
| `due` | a student at 11:48 PM | a ceiling fan, crickets outside |
| `pay` | at dinner with friends | chatter (`babble.py`), cutlery, the AC |

To redo one: `python read.py hands r.wav`, then
`python scene.py r.wav hands kitchen 24 "<the caption's words>"`; the
exact commands for each are in the commit that added them.
