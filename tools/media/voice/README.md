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
