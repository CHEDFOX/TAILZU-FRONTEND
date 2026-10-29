# X0 Bot: the Curious, hanging upside down

The hand-drawn Curious bot (`../handdrawn-v2`, version 3) hangs by its hands from a bar along the top, with its head down and its glowing eyes on you. There's no antenna. Each version is drawn the right way up, gripping a ledge, then turned 180 degrees, so the ledge becomes the bar.

| Version | Ground |
| --- | --- |
| `1-white` | white, with the bar's top band a breath darker |
| `2-paper` | the Curious's own cream paper and clay brush ring |
| `3-black` | white, with the current black head |
| `4-cocked` | white, with the head cocked the other way |

```sh
node render.mjs [id ...]                              # <id>/icon-1024.png (uses ../handdrawn-v2)
node ../handdrawn-v2/sheet.mjs /tmp/x0-curious-hang.png .
```
