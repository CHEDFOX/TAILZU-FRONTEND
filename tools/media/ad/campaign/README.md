# X0 Bot campaign: ten brand spots

Ten 9:16 films (1080 x 1920, 30 fps) for brand, promotion and awareness. Each was pitched in a directors' room
(`pitches.json`, `room.json`), written into one bible (`bible.json`: shots, copy, sound and the shared system), sourced
from open-licence footage, built on the ad kit (`../adkit.js`), critiqued for brand and craft, fixed and rendered.

| # | Spot | Length | Director's lens | Footage |
|---|------|--------|-----------------|---------|
| 01 | He had a team | 24.4 s | The Trickster | Prelinger public-domain office, rail and switchboard films through a tear in the paper |
| 02 | Pahunch gaye? | 30.4 s | The Humanist | Mixkit / Coverr night streets, a wing at dusk, rain on glass, a back seat, a tower block |
| 03 | Great at One Thing | 27.4 s | The Symmetrist | Mixkit single-craft portraits; the cook from the kitchen clip |
| 04 | Khaana khaya? | 24.4 s | The Humanist | Coverr hands and phone; the cook from the kitchen clip |
| 05 | Leave at 4:40 | 20.4 s | The Minimalist | Mixkit door and keys, an underground platform |
| 06 | The Hold | 26.7 s | The Precisionist | Mixkit sprinter, chess hand, dive; Coverr departing train |
| 07 | Go Live | 22.9 s | The Precisionist | Mixkit typing; NASA and Moonwalk One (archive.org) pad, firing room and launch |
| 08 | In One Sentence | 24.4 s | The Symmetrist and the Trickster | Coverr hallway, shoe and a runner at dawn |
| 09 | Uncle is right | 22.4 s | The Humanist | The fox clip (supplied) |
| 10 | The Witness | 30.5 s | The Precisionist | The fox clip (supplied) |

Every spot ends on the same end card (the hero on his bar, the painted X0, "Your team of bots", "Coming soon /
x0bot.com").

## Files

- `../spots/<id>.html` and `<id>.js`: the film, a pure function of time on the ad kit. Some spots have `<id>-sound.mjs`
  or `<id>-sfx.py` (they write `<id>-sfx/*.wav`) and `<id>-mask*` helpers.
- `../voice/<id>-*.wav` and `.json`: the voice lines with word times (edge-tts, see `../voice.mjs`).
- `../footage-<id>-*/`: the prepared frames (gitignored; rebuild them with `../prep.mjs` from the sources in `credits/`).
- `credits/<id>.json`: every footage source a spot's finder picked, with its page, licence, stretches and the marks to
  avoid, plus what the build actually used (`footage_used`).

Render a spot (from `tools/media`):

```
PW_ROOT=$(npm root -g)/.. node trailer/render.mjs out --page ad/spots/<id>.html --ratio 9x16 --name <id>
ffmpeg -i out/<id>-9x16.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 192k -ar 48000 out/x0-<id>-9x16.mp4
```

## Before release

- **10 The Witness**: "Who buys your data? No one. Not for sale." Use only if the privacy policy says exactly this.
- **07 Go Live**: Moonwalk One (1970) is marked public domain on archive.org by its uploader, but it was made for NASA
  by a private studio and later re-released, so confirm its status or swap in the NASA-produced alternatives listed in
  `credits/07.json`. The firing-room shot shows identifiable 1969 staff.
- **04 Khaana khaya?**: "Speak in any app" and "Hindi, Hinglish and 50+ languages" match `docs/store-listing.md`; keep
  them in step if the listing changes.
- **Hinglish reads** (02, 04, 09): neural voices; have a native speaker listen once.
- Stock models' faces (03 barber, 06 sprinter) are covered by the Mixkit licence.

## Copy rules every spot follows

No prices, no other companies' or apps' names, no "best", no exclamation marks, and nothing the app does not do:
Keybot writes and the user sends; bots find and ask, you press pay; the Code bot works on a safe copy, builds, and
nothing goes live till you say yes; a made bot plans and reminds.
