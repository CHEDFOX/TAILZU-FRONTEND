# Tailzu Keyboard — Native-Feel Spec (iOS + Android)

Derived from a deep study of Apple's iOS keyboard and AOSP LatinIME (Gboard's lineage).
Values marked `[approx]` are reverse-engineered/framework defaults — tune on-device.
Values from source (AOSP timings, iOS 216pt, etc.) are exact.

---

## iOS (custom `UIInputViewController` extension)

### Layout (points)
- **Keys area height: 216 pt** (near-constant across iPhones; Plus/Max ~226). Don't scale by screen height.
- Key **width = screenW ÷ 10**; **height ~42–43**; corner radius **~5**.
- Insets: **~3 horizontal** per key, **~5–6 vertical**, **~3 edge**, **~8–12 top**.
- **Row centering:** row 2 (9 keys) inset ~½ key each side; row 3 (7 letters) flanked by shift+delete.
- Special widths (× letter): shift ~1.4, delete ~1.4, 123 ~1.4, return ~1.5–2, space fills (~5×).
- Bottom row: `[123] [🌐] [ space ] [return]`.

### Colors — CONFIRMED from KeyboardKit source
- **Light:** kb bg `#D5D6DD`, letter key `#FFFFFF` @**0.95 opacity**, special key `#ABB1BA`, text system label (`#000`). Pressed: letter → grey (theme reversal), special → white.
- **Dark:** kb bg `#2C2C2C`, letter key `#6B6B6B`, special key `#474747`, text `#FFF`. Pressed → lighten.
- Primary (blue return) key: `systemBlue`, white text.
- Key shadow: black, **opacity 0.30 light / 0.70 dark**, offset `(0,1)`, **radius 0** (hard 1px edge). No border.
- Font: SF system — letters **23 pt** (26 pt `.light` for lowercase-with-uppercase-variant), space/return labels **16 pt regular**, shift/delete/globe SF Symbols ~20. Corner radius **5 pt** (iPhone, confirmed).

### Feel — CONFIRMED from KeyboardKit/GestureButton source
- **Key-pop callout** ("Character Preview"): balloon above **letter/emoji keys only** (NOT space/return/shift/delete/123), **phone-only**, suppressed in landscape. Bubble **cornerRadius 10**, **curve 8×15**, content height **55 pt**, glyph font `largeTitle .light`, shadow black@0.1 radius 5. Appears on **touch-down**, hides on release via **opacity** transition (~0 duration). Lives inside the keyboard view → leave top headroom.
- **Press-down:** background swap (letter darkens / special lightens), **instant on down**, ~0.1s ease-out on up. **No key scale** (the "growth" is the callout).
- **Delete repeat:** initial delay **0.5s**, interval **0.1s** (constant — KeyboardKit has no built-in acceleration; add word-delete after ~2–3s hold for native parity).
- **Long-press accents** ("action callout"): trigger **0.5s**, horizontal row of alternates above the key, **50×50 pt** items, slide to highlight (blue), release to commit. Per-locale accent sets.
- **Haptics:** `UIImpactFeedbackGenerator` — KeyboardKit standard: **`.selectionChanged` on tap/release/repeat**, **`.mediumImpact` on long-press**. **Requires "Allow Full Access"** (else silently suppressed); native keyboard haptics are OFF by default (Settings ▸ Sounds & Haptics ▸ Keyboard Feedback ▸ Haptic).

### Behaviors
- Shift: one-shot (tap) / caps-lock (double-tap ~0.3s). Auto-cap at sentence start (inspect `documentContextBeforeInput`).
- 123 page: `1234567890 / -/:;()$&@" / #+=  .,?!' ⌫`. #+= page: brackets/math/currency.
- Double-space → `. `; smart quotes/em-dash (must reimplement — not free via `insertText`).

### Walled off by Apple
- System autocorrect/QuickType ML (use `UITextChecker` + `UILexicon` instead), Apple's swipe engine, native callout views, `UIKeyboard` internals. Memory cap ~48–60 MB.

### Foundation
- **KeyboardKit** implements layouts, callouts (key-pop + accents), haptics, gestures/repeat, styling. Free tier covers the feel; Pro (paid) adds autocomplete/dictation/emoji. Defaults: radius 5, insets 3, repeat 0.5/0.1, letter font 23.

---

## Android (custom `InputMethodService`)

### Layout (the `%p` model — sizes are % of keyboard width)
- Letter key **10%p**; shift/delete/?123/enter **15%p**; space ~40–50%p; comma/period 10%p.
- Row 2 indented `keyXPos 5%p` each side; row 3 = shift 15% + 7×10% + delete fillRight.
- 4 letter rows ≈ **210–240 dp** + suggestion strip **~40–48 dp**. Key radius **~8 dp**, **flat (0 elevation)**.
- Text size as ratio of row height: letter **0.55**, label **0.36**, hint **0.22**.

### Colors (Material You — pull from `android.R.color.system_*` at runtime)
- **Light:** kb bg `~#ECEFF1`, letter key `#FFFFFF`, special `#DADCE0`, text `#1F1F1F`, enter = accent.
- **Dark:** kb bg `#202124`, letter key `#3C4043`, special `#2A2D2E`, text `#E8EAED`.

### Feel (timings from AOSP source — exact)
- **Key preview:** balloon above pressed letter keys only; **linger 70ms**, suppressed 1000ms after glide.
- **Press:** instant pressed-bg swap (+ optional Material ripple).
- **Delete repeat:** start **400ms**, interval **50ms**.
- **Long-press more-keys:** **300ms** (Gboard slider 100–700).
- **Haptics+sound on key DOWN:** `performHapticFeedback(KEYBOARD_TAP)` (no permission needed) + `AudioManager.playSoundEffect(FX_KEYPRESS_*)`.

### Behaviors
- Shift one-shot / caps (double-tap ~1200ms). Auto-cap via `getCursorCapsMode`.
- ?123 → 2 symbol pages. Double-space → `. ` within **1100ms**.
- Glide typing: capture+trail easy (trail 10→2.5dp taper, update 20ms), **decoder is the hard part** — borrow AOSP/FUTO native decoder + dictionary, or defer.

### Foundation / references
- **AOSP LatinIME (FUTO fork, gitlab.futo.org/keyboard/latinime)** — reference for `%p` layout XML, timing constants, more-keys popup, and a working **glide decoder + dictionary** to reuse.
- **FlorisBoard (github.com/florisboard/florisboard)** — modern Kotlin/Compose structure, theming, state model to borrow.
- Use a custom `View`+`Canvas` for the key grid (deprecated `KeyboardView` classes — copy the pattern, not the classes); Compose only for chrome.

---

## Build order (both platforms — max native feel per effort)
1. **Proportional layout + row centering** (iOS screenW÷10; Android `%p`). Biggest instant win.
2. **Press feedback trio:** pressed-color swap + **haptic** + **key-sound** on touch-down.
3. **Key-pop callout** (letter keys only).
4. **Shift state machine + auto-capitalization.**
5. **Delete auto-repeat** (iOS 0.5/0.1; Android 400/50) → word-delete acceleration.
6. **Light/Dark theming** (+ iOS key shadow / Android flat + dynamic accent).
7. **123 / symbol pages + double-space period + smart punctuation.**
8. **Long-press accent/more-keys popup** (iOS 0.5s / Android 300ms).
9. **Glide trail UI** (visual).
10. **Glide decoder + autocomplete** (borrow KeyboardKit Pro / AOSP decoder). Heaviest; add last.

Keep the **skin** (colors, tone options, sizes, labels) server-tunable via `/v1/keyboard/config`; the **engine** (callouts, gestures, haptics) ships native.

## The mic key's mark comes from the server

The `MicKey` node carries the brand mark as geometry and the motion it has, so
the mark can be resized, recoloured or set moving with a backend deploy — no
store build. Only geometry is accepted: a picture can never stand where the
mark stands, on either platform.

```json
{
  "type": "MicKey",
  "props": {
    "mark": {
      "viewBox": [170, 228, 680, 512],
      "tint": true,
      "shapes": [
        { "kind": "rect", "x": 308, "y": 269, "w": 132, "h": 132, "rx": 28, "color": "#F4F1EA" },
        { "id": "link", "kind": "line", "x1": 444, "y1": 394, "x2": 554, "y2": 486, "width": 30, "dash": [9, 11], "color": "#E8A23C" },
        { "id": "dot", "kind": "circle", "cx": 828, "cy": 243, "r": 11, "color": "#B06240" }
      ]
    },
    "motion": {
      "idle": [
        { "on": "mark", "kind": "signal", "period": 3.6, "color": "#F4F1EA", "steps": [
          { "on": "c", "at": 0.33, "hold": 0.42 },
          { "on": "a", "at": 0.92, "hold": 0.42 },
          { "on": "link", "at": 1.33, "run": 0.95 },
          { "on": "b", "at": 2.33, "hold": 0.42 }
        ] },
        { "on": "mark", "kind": "breathe", "period": 4.2, "scale": 1.06, "opacity": 1 },
        { "on": "link", "kind": "hatch", "period": 2.6 }
      ],
      "recording": {
        "kind": "physics", "force": 1, "wall": 0.96, "blend": 1.2, "settle": 1,
        "scenes": [
          { "name": "jelly", "for": 7, "hold": 45, "stiff": 0.9, "drag": 2.5, "bounce": 0.4, "kick": 1.8, "jitter": 0.5, "squash": 1 },
          { "name": "swing", "for": 9, "hold": 10, "stiff": 0.85, "gravity": 1.8, "spin": 45, "bounce": 0.5, "kick": 1.2, "squash": 0.9 },
          { "name": "orbit", "for": 8, "stiff": 0.6, "drag": 0.05, "centre": 4, "bounce": 0.9, "kick": 0.9, "launch": 2 },
          { "name": "hang", "for": 8, "pin": ["dot"], "stiff": 0.95, "gravity": 1.8, "bounce": 0.3, "kick": 1.2 }
        ]
      }
    }
  }
}
```

- `shapes`: `rect` (x, y, w, h, rx), `line` (x1, y1, x2, y2, width, cap, dash), `circle` (cx, cy, r). Coordinates are the artboard's; `viewBox` is the part shown, aspect-fit into the key.
- `fit: "circle"` (default) scales the artboard so its diagonal spans the key, which keeps every corner inside a round key; `"box"` fits the sides.
- `tint: true` paints every shape in the key's `fg`; `false` uses each shape's `color`.
- `motion.idle`: `signal` (on `"mark"`) is the splash's sequence on a loop, a timeline of `steps` over `period` seconds. Each step names a shape and the second it lights (`at`): a square or plain line wears the signal `color` for `hold` seconds (on in 60ms, off in 60ms); a dashed line has a run of light travel its length for `run` seconds, dash by dash, in step with its hatch. `color` defaults to pale on a tinted mark and amber otherwise. `breathe` swells a shape (or `"mark"`, the whole) to `scale` and fades it to `opacity` and back; `hatch` runs a dashed line's dashes along it. All on `period` seconds; all honour the system's reduce-motion setting. On a 36pt key the signal and the breath are what shows; the hatch is for the sizes where dashes resolve.
- `motion.recording`: what the key does while the microphone is open. `{ "kind": "physics", ... }` — the structure becomes a physical thing inside the round key. The squares and the dot are masses (a square's collision radius is 0.45 of its side; the dot's is 1.5 of its radius, at least 3% of the artboard's short side); each line is a rod between the two nearest masses, a distance constraint solved by position, rigid at `stiff` 1 and rubbery below; the rim is a wall at `wall` of the key's radius; masses collide with restitution `bounce`. `scenes` run in order, each for `for` seconds, and blend into the next over `blend` seconds by lerping every number. A scene's numbers, all optional: `hold` (tether to home, 1/s²), `gravity` (key-widths per s², turning `spin` degrees a second; at 0 spin it settles to straight down), `wind` and `swirl` (a current of eddies plus a turn about the middle), `centre` (a pull to the middle, for orbits), `kick` (what a rise in the voice throws into one mass, in key-widths a second, against gravity when there is any), `jitter` (ambient shake, fed by the voice), `squash` (how far a square stretches along its own speed and squashes across it), `launch` (a turn about the middle, radians a second, given once on entry), `toss` (seconds of quiet before every mass is thrown up against gravity), `pin` (ids held fast at home). Squares turn with their rods. The live microphone level feeds the wind, the jitter and the kicks; `force` scales every push. Each recording starts on the scene after the last one's. On stop the wall goes and the numbers blend, four times faster, to a stiff, critically damped tether, so the mark comes home within `settle` seconds and lands exactly; the same view stays mounted throughout and the idle motion resumes. `"particles"` — the mark bursts into the dot sim and springs back on stop — or `"none"`. A build before the physics reads a name only and shows its particles.
- A shape kind or motion kind a build does not know is skipped. A build older than this ignores both props and draws its bundled mark; a backend older than this sends neither and the keyboard does the same.
