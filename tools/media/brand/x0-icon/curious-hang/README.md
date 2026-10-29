# X0 Bot: the Curious, hanging upside down

The hand-drawn Curious bot (`../handdrawn-v2`, version 3) hangs by its hands from a bar along the top, with its head down and its glowing eyes on you. There's no antenna. Each version is drawn the right way up, gripping a ledge, then turned 180 degrees, so the ledge becomes the bar. `flipLight` puts every light on the far side while drawing, so once turned the light comes from the top left.

| Version | What it is |
| --- | --- |
| `1-black` | The refined black head on white. It's centred and lit from the top left: catchlights, gloss, and a soft shadow on the wall. It has a glossy visor with a faint rim, warm glowing eyes and white gloves. |
| `2-crafted` | The same bot, hand-crafted: gouache and ink on cotton paper. The paper's tooth shows through, the black is dry-brushed, the line wobbles like a dip pen, the bar's band is pencil-hatched, and two brush marks show the swing. |
| `3-x0-eyes` | The refined black with a hidden x0: the left eye's glint is a little diagonal sparkle (an x), the right eye's a ring (a 0). |
| `4-x0-ears` | The hidden x0 on the ear pods: a cross-head screw on the left, a round rivet on the right. |
| `5-x0-both` | Both. From a distance they're just glints and screws. |
| `6-painted` | Painted the way the Claude mark is: flat colour only (no outlines, gradients, highlights or shadows), with every edge cut in short, slightly uneven straight facets. It has our colours: a black bot on warm white, a stone-grey bar, cream gloves and eyes, and clay ears. |
| `7-painted-ink-bar` | The bar painted black too, so the bot and the bar read as one shape. |
| `8-painted-clay-bar` | A clay bar, the same clay as the ears. |
| `9-painted-no-visor` | The simplest painted one: one black head, two cream eyes, cream gloves and clay ears. |

```sh
node render.mjs [id ...]                              # <id>/icon-1024.png (uses ../handdrawn-v2)
node ../handdrawn-v2/sheet.mjs /tmp/x0-curious-hang.png .
node launch.mjs --blip <backend>/tulmi/blip/bots      # 8-painted-clay-bar, small, on a piece of its bar: app/assets/launch (splash + the launch's layers)
```
