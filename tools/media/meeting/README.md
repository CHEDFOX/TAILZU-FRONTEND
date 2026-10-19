# The meeting in "Bleeped"

The voices in the Bleeped film (`FILMS.bleeped` in `social.html`) are a
real meeting: **ES2002a** of the **AMI Meeting Corpus**, a design team's
kick-off recorded in 2004 at the University of Edinburgh. Four people are
asked to design a remote control. They spend five of the meeting's 18
minutes drawing their favourite animals on the whiteboard (the corpus's
own topic annotation, 151.8 s to 453.6 s), then learn the remote sells
for 25 euros and can cost no more than 12.50 to make; nine and a half minutes in,
the project manager says "Oh gosh, I should be writing all this down."

- `cut.py` cuts the track. It downloads the four headset recordings and
  the manual annotations into `src/` (gitignored), gates each voice to
  when that person speaks, levels each clip, bleeps the off-topic words
  with a 1 kHz tone, and writes the two files below. Every cut, every
  bleep and every caption fix is in its `CLIPS` list, in the meeting's
  seconds.
- `bleeped.wav` is the track: 48 kHz, 16-bit, mono, 27.8 s.
- `bleeped.js` is `window.TZ_MEETING`: every captioned word on the
  track's clock, who said it, and whether it was bleeped; the bleeps; and
  where in the meeting each piece of the track comes from.

## Credit and licence

Audio and transcript: the AMI Meeting Corpus, © the AMI Consortium and
the University of Edinburgh, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
(<https://groups.inf.ed.ac.uk/ami/corpus/>). **Changed:** excerpted, mixed
again from the individual headset microphones, levelled, and some words
replaced by a bleep tone.

Wherever the film is posted, its caption should carry the credit, for
example: *Audio: AMI Meeting Corpus (CC BY 4.0), edited and bleeped.* The
end card carries a short form of it.

## Before it runs as a paid ad

The voices belong to the meeting's four participants. They were recorded
for research and the corpus is openly licensed. However, CC BY 4.0
licenses the recording's copyright, not personality or publicity rights
(section 2(b)(1)). The film uses no names; the roles stand in for them.
Before the film runs as paid advertising, have someone confirm that this
use is fine. If it isn't, re-record the same lines with actors. `CLIPS`
in `cut.py` is the script, with every line's timing.
