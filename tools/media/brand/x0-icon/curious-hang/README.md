# X0 Bot: the Curious, hanging upside down

The hand-drawn Curious bot (`../handdrawn-v2`, version 3) hangs by its hands from a bar along the top, with its head down and its glowing eyes on you. There's no antenna. Each version is drawn the right way up, gripping a ledge, then turned 180 degrees, so the ledge becomes the bar. `flipLight` puts every light on the far side while drawing, so once turned the light comes from the top left.

| Version | What it is |
| --- | --- |
| `1-black` | The refined black head on white. It's centred and lit from the top left: catchlights, gloss, and a soft shadow on the wall. It has a glossy visor with a faint rim, warm glowing eyes and white gloves. |
| `2-crafted` | The same bot, hand-crafted: gouache and ink on cotton paper. The paper's tooth shows through, the black is dry-brushed, the line wobbles like a dip pen, the bar's band is pencil-hatched, and two brush marks show the swing. |

```sh
node render.mjs [id ...]                              # <id>/icon-1024.png (uses ../handdrawn-v2)
node ../handdrawn-v2/sheet.mjs /tmp/x0-curious-hang.png .
```
