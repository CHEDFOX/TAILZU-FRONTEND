# X0 Bot · films on footage (the ads and the campaign)

Short films built on real or stock footage with the brand's paper world laid on top: the dictation that becomes
handwriting, the freeze that goes cold, the taped paper card with a bot's answer, the heavy white headline with one word
by hand, the painted X0 and the white sheet at the end. The kit they draw with is the trailer's
(`../trailer/engine.js`, its components, hero layers and fonts), so every film is one hand.

```
adkit.js        what every film shares: AD.start (footage frames, voice word times, the page wiring), AD.map (slow motion,
                freezes, ramps), AD.film (the grade), AD.caption / AD.dots (the voice on screen), AD.card (the taped card),
                AD.headline, AD.slam, AD.markPaint, AD.endCard + AD.endCues (the campaign end card), AD.cornerMark
example.html    a nine-second use of everything in the kit, on the fox footage
kitchen.html/js "Hands full": a man cooking dictates three jobs to his bots (31 s)
dance.html/js   "The evening is yours": six words on six beats over a dancer, the lights coming on (21 s)
spots/          the campaign's spots, one html + js each (built from the campaign bible)
prep.mjs        a clip -> frames at 1080 x 1920, motion-interpolated to 72 fps (footage-<name>/, not in git)
voice.mjs       a voice line -> WAV + word times (edge-tts through the proxy); voice/say.py underneath
stock/find.mjs  open-licence footage: Coverr, Mixkit, the Internet Archive -> clips, contact sheets, a manifest
voice/          the recorded lines (WAV + JSON)
```

## Make a film

```sh
node prep.mjs <clip.mp4> footage-<name>/ [--crop x,y,w,h] [--fps 72]            # the frames (about a minute per second of clip)
node voice.mjs <line> "<text>" [--voice en-IN-PrabhatNeural] [--rate +6%]        # a voice line and its word times
node stock/find.mjs "rain on window" --n 6                                         # candidates in stock/found/<query>/ with sheets
PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page <film>.html --ratio 9x16                      # the film, with sound
PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page <film>.html --ratio 9x16 --stills --scale 0.5 --query "hud=1"
ffmpeg -i out/<film>-9x16.mp4 -c:v copy -af loudnorm=I=-14:TP=-1:LRA=11 -c:a aac -b:a 192k out/<film>-final.mp4   # social loudness
```

A film is a page that loads `../trailer/engine.js` and `adkit.js` and calls `AD.start({ footage, voices, scripts,
duration, frame(t, S), cues(S) })`: `frame` draws the moment t in a 1080 x 1920 space, `cues` lists the sounds
(`../trailer/sound.mjs`'s kinds, plus `sample` for a voice WAV). Everything is a pure function of t, so render.mjs can
draw any frame in any order and the file is the design exactly.

## Licences

Coverr and Mixkit clips are free for commercial use without attribution under their own licences; from the Internet
Archive only public-domain / CC0 items are taken (find.mjs filters on the licence URL). Every downloaded clip's source,
page and licence are in its `meta.json`. The voices are neural reads (edge-tts); the music is synthesised here.
