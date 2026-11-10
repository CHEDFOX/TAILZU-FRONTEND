# X0 Bot · "Hands full" (the kitchen ad)

A 31 s vertical ad (1080 x 1920) built on one real clip: a man cooking at night, steam, a hood light, a locked-off
camera, five seconds, no sound. He dictates three jobs to his bots while his hands are busy; on each last word the film
freezes, goes cold, and a paper card with the bot's answer is taped onto the frame; then the kitchen breathes again. A
headline, and the brand's white sheet slides up over it all: the hero on his bar, the painted mark, the stamp.

```
kitchen.html / kitchen.js   the film: a pure function of time over the footage frames, the voice's word times, the cards
voice/                      the three dictation lines: <line>.wav (48 kHz mono) and <line>.json (word times, seconds)
voice/say.py                how they were made: edge-tts, voice en-IN-PrabhatNeural at +6 %, through the proxy
footage/                    (not in git) the clip's frames, motion-interpolated to 72 fps at 1080 x 1920, s0001.jpg …
```

The kit it draws with is the trailer's (`../trailer/engine.js`, its components, hero layers, fonts), so the ad and the
trailer are one hand.

## Make the footage frames

```sh
ffmpeg -i <clip.mp4> -vf "scale=1080:1920:flags=lanczos,minterpolate=fps=72:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" -q:v 2 footage/s%04d.jpg
```

(about four minutes for a 5 s clip; the ad plays the frames slow, so the interpolation is what keeps the slow motion
smooth). The clip itself is the client's and is not in the repo.

## The voice

```sh
cd voice && SSL_CERT_FILE=/root/.ccr/ca-bundle.crt python3 say.py plan en-IN-PrabhatNeural +6% "Plan... move dinner with Mom to eight thirty. And tell her."
ffmpeg -i plan.mp3 -af "areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.1" -ar 48000 -ac 1 -c:a pcm_s16le plan.wav
```

The timeline is laid out from the voice files' lengths (kitchen.js reads `voice/<line>.json`), so a re-recorded line
moves everything after it and the captions still land on the words.

## Render

```sh
PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page kitchen.html --ratio 9x16          # the film, with sound
PW_ROOT=$(npm root -g)/.. node ../trailer/render.mjs out --page kitchen.html --ratio 9x16 --stills --scale 0.5 --query "hud=1"
ffmpeg -i out/kitchen-9x16.mp4 -c:v copy -af loudnorm=I=-14:TP=-1:LRA=11 -c:a aac -b:a 192k out/kitchen-9x16-final.mp4   # social loudness
```
