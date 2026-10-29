# X0 Bot: marks made of the letters

This is a different direction from the bot. There's no character: x and 0 are the shapes. Each mark is painted the way the Claude mark is: flat colour with no lines or shading, and every edge cut in short, uneven straight facets. Each sits on its own colour field. The marks use the paper and media model of `../handdrawn-v2/draw.js`.

| Version | Idea |
| --- | --- |
| `1-hug` | "xo" means hugs and kisses. The x and the o are linked like a chain, each over and under the other. Tomato and ink on cream. |
| `2-lettering` | The name, hand-painted: a short x and a tall 0 on one baseline. Ink on acid lime. |

Four ideas were dropped because each read as something else. The 0 as a head over an x body (a little leaping figure) is too close to an existing logo. An x spark circling the 0 read as the male symbol, and on the 0's rim it read as a bomb's lit fuse. An x above a 0 rising from the bottom edge read as a dead face.

```sh
node render.mjs [id ...]                              # <id>/icon-1024.png
node ../handdrawn-v2/sheet.mjs /tmp/x0-marks.png .
```
