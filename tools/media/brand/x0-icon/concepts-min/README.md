# X0 Bot: eight minimal concepts

These are deliberately flat. The point is to pick a direction before anything gets a polished render. Each concept is one silhouette plus two eyes with attitude (at most one signature detail) on a loud colour field. Files are `<n>/icon-1024.png` (1024, RGB, full bleed).

Ranked:
1. `4-half-peek`: only the top of the box head clears the bottom edge, and the eyes slide sideways. Pure Peek, clear at 29 px.
2. `8-corner-eye`: a huge head slides in from the edge, and only one eye has made it round the corner. The boldest.
3. `1-kilroy`: head, fingers and wall as one black shape, with sly slits for eyes. Instantly understood, but not ownable.
4. `3-visor`: one black visor band on acid lime with determined eyes. Reads as a masked bandit.
5. `7-two-tone`: a black box head on white, one eye narrower. The closest in spirit to Grok Bot.
6. `6-bolt-antenna`: a lightning-zag antenna as the signature. Says "electric", not "helper".
7. `5-x0-attitude`: an X squint and a 0 eye. The X still reads as "knocked out".
8. `2-sly-square`: reads "unimpressed". Dropped.

```sh
python3 concepts.py                                   # all eight (uses ../bold/lib.py)
REF=/path/to/grok-bot-1024.png node sheets.mjs grid /tmp/x0-min-concepts.png
REF=/path/to/grok-bot-1024.png node sheets.mjs home /tmp/x0-min-home.png
```

The reference icon is another company's and is never stored here; pass its path in `REF`.
