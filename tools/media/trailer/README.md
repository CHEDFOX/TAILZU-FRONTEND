# X0 Bot · the pre-launch trailer

A short cinematic trailer for X0 Bot, made entirely from the brand's own hand: the app icon's bot (the painted black bot
hanging from his clay bar, drawn by the icon's own code, with the app's own launch motion), the paper, the heavy Geist
headlines with one word written by hand, and new handcrafted components painted with the same paper-and-ink model as the
icon. No stock, no licensed music: the sound is synthesised here too.

```
trailer.html         the film: every beat as a function of time, one timeline, two cuts (9:16 and 16:9)
engine.js            the drawing kit: easing, fonts, paper, the headline system, the hero bot (launch motion ported from
                     app/src/launch/launchCore.ts), peeking, cards, screens, wipes, grain
render.mjs           frames → H.264 with the sound muxed in (Playwright + ffmpeg)
sound.mjs            the sound: a bed, a heartbeat, risers, a boom, the brand's clicks and bells, the final chord
lift.mjs             paints handcrafted components with brand/x0-icon/handdrawn-v2 and lifts them to RGBA PNGs
components.jobs.mjs  the components' recipes (swashes, the painted X0 mark, tape, a torn edge, an ink ring, …)
components/          the painted components (PNG) and components.json (their sizes)
hero.mjs             the hero's extra layers: his face without eyes, and his eyes alone, so they can move
hero/                the hero's layers at 1632 px (the same frame as store/out/art/hang-*-1632.png)
fonts/               Geist, Caveat, Bricolage Grotesque, Geist Mono, Newsreader, Kalam, Noto Devanagari (OFL)
storyboard.json      the final storyboard the film was built from (the creative panel's output)
```

## Render

```sh
PW=$(npm root -g)/..                                    # or any dir whose node_modules has playwright
PW_ROOT=$PW node tools/media/trailer/render.mjs out/trailer                      # both cuts, with sound
PW_ROOT=$PW node tools/media/trailer/render.mjs out/trailer --ratio 9x16 --scale 0.5   # a quick half-size look
PW_ROOT=$PW node tools/media/trailer/render.mjs out/trailer --stills            # 12 frames + a contact sheet per cut
PW_ROOT=$PW node tools/media/trailer/render.mjs out/trailer --range 8,14        # one stretch, to check a beat
```

Writes `x0-trailer-9x16.mp4` (1080 x 1920) and `x0-trailer-16x9.mp4` (1920 x 1080), H.264 High, 30 fps, AAC stereo,
faststart; `--poster <s>` also writes the frame at that second as a PNG.

## Repaint the components

```sh
PW_ROOT=$PW node tools/media/trailer/lift.mjs tools/media/trailer/components.jobs.mjs tools/media/trailer/components [name …]
PW_ROOT=$PW node tools/media/trailer/hero.mjs                                   # the hero's face and eyes layers
```

Every component is a recipe in `components.jobs.mjs`: a function that paints in the icon's 1000-unit square with the
drawing library's paper, ink and gouache (`HD.Art`, `HD.M.ink`, `HD.M.hatch`, …), drawn on black and on white and matted
to RGBA the way `store/art.mjs` lifts the store frames' art. Same seed, same picture.

## How the film is built

`trailer.html` takes `?w=&h=` and exposes `window.__frame(t)` (seconds), `window.TRAILER.duration` and
`window.__cues()` (the sound cues, `[{ at, kind, … }]`, see sound.mjs). Everything is a pure function of `t`, so a frame
can be drawn in any order and the render is the design exactly. Sizes are in `u` (one pixel at a 1080-px short side), so
the same numbers fit both cuts; `portrait` switches the composition where the two differ.
