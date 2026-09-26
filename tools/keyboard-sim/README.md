# Keyboard simulator

Types into the iOS keyboard's real touch code on Linux, with no phone and no build.

```
./run.sh                    # the working tree
./run.sh fc45645 HEAD .     # compare any revisions; "." is the working tree
KBSIM_STRICT=1 ./run.sh     # fail on any keyboard-caused error (CI)
```

Each target writes `build/<stamp>-<rev>/report.txt`, `results.json` and `coverage.png`.

## What is real, and what is modelled

**Compiled verbatim** from `app/targets/keyboard/SDUIRenderer.swift` at the chosen revision, by `gen.py`:

- `KeyPlaneView`, `KeyRowStackView` and `KeyHitButton`.
- The renderer's keystroke path: `planeCommit`, the accent-tray retract, the `insertKey` case, the accent map, and the whole "Lift keys" section.

The only edits are mechanical. `@objc` is dropped, and `#selector(f(_:))` becomes a closure calling the same method.

**Modelled** in `Shim.swift`, from UIKit's documented and observed behaviour:

- Hit-testing skips hidden and non-interactive views, and only descends into a subview when the point is inside its parent.
- A control's lift within 70pt is `touchUpInside`; a lift beyond that is `touchUpOutside`.
- A view without multi-touch takes one finger at a time.
- The space bar's 300ms long-press takes the touch and cancels it on the button.
- Time is virtual, so timers, `CACurrentMediaTime` and the accent-tray delay are deterministic.

**Mirrored** in `Renderer.swift.in`: the renderer's glue that is logic rather than paint. That covers keyTouchDown's flush, the space tap, shift and backspace. Auto-cap and suggestions are off; the host field reports no auto-capitalisation.

**Geometry and flags** come from `config.json`, a snapshot of what the backend serves an iPhone. Refresh it from the backend repo:

```
npx tsx -e 'import {buildKeyboardConfig} from "./src/experience/catalog.ts"; console.log(JSON.stringify(buildKeyboardConfig(undefined, undefined, {platform: "ios", kbBuild: 40})))' > config.json
```

## Scenarios

1. **Coverage.** One tap at every point of the keyboard. It counts dead points and points that type something other than the nearest key, and draws the map.
2. **Fast typing.** A two-thumb typist at 40 to 120 wpm, with every touch landing on its key. Alternating thumbs are faster than same-thumb presses, and a thumb must lift before it presses again. Errors are measured against what a perfect keyboard types for the same touches, so they are the keyboard's alone.
3. **Real thumb aim.** Touches spread over gaps and edges, with and without the bigram bias.
4. **Edge cases.** Overlapped space and return, accent holds, shift chords, double-space, trackpad hold, cancelled taps, and far lifts.

## What it cannot tell you

It measures logic, not device timing. It won't see main-thread stalls, host-app insert latency or iOS gesture gates, and the typist is a model, not a person.
