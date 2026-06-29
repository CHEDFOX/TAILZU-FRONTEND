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
