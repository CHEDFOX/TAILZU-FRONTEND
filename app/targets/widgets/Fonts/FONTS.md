# The widget extension's bundled faces

Format 1 promises five type tokens in **every** target, and three of them need a file here. All four faces are now in this
folder, with their OFL texts beside them.

| token | file | name `UIFont(name:)` answers to | weights a design may ask for |
|---|---|---|---|
| `sans` | none — the system face | — | 400 to 800 |
| `brand` | `Geist-Medium.ttf`, `Geist-SemiBold.ttf` | `Geist-Medium`, `Geist-SemiBold` | 500, 600 |
| `display` | `BricolageGrotesque-SemiBold.ttf` | `TailzuBricolageSemiBold` | 600 |
| `dots` | `Doto-Regular.ttf` | `Doto-Regular` | 400 |
| `mono` | none — the system monospace | — | 400 to 800 |

`NLookType.registeredName` (`../NLookStyle.swift`) holds exactly these four names as a fixed table. They are **read out of
each file's name table**, not guessed from the family: the display face is a renamed cut, so no "family + face" guess would
ever find it. If a face in this folder is ever replaced, check its name table and change that table in the same commit.

## What is here, and how it was made

Run on 13 Nov 2026 with fontTools 4.68.0. Every input was already an OFL 1.1 font; three of the four came out of this
organisation's own repositories and only Doto was fetched.

| file | bytes | sha256 |
|---|---|---|
| `Geist-Medium.ttf` | 27,832 | `b7c2711bea921b5781f996c331d851a0478e733b71f9ab57f93ffd7d9e7d1fa6` |
| `Geist-SemiBold.ttf` | 27,712 | `f58ae1b9d8daa8dfecadc3f0ac6778acf1264cd4b094e838b71df32675893148` |
| `BricolageGrotesque-SemiBold.ttf` | 48,496 | `d792444bbe8d7d06a216e262d8139ce15e5680afb21e918acf36aeb43bcfde74` |
| `Doto-Regular.ttf` | 82,216 | `adeecbe13ff100b673fccbb4152a9aeed5d9b071ca30b6574f73e2321806c851` |

186 KB in all, against this folder's budget of about 600 KB.

**Sources.** `Geist-Medium` and `Geist-SemiBold` are `TAILZU-BACKEND/tulmi/fonts/geist-{medium,semibold}.ttf`, subset.
`BricolageGrotesque-SemiBold.ttf` is `TAILZU-BACKEND/tulmi/fonts/bricolage-semibold.ttf` copied byte for byte — the same cut
the app's own screens download from `/fonts/`, so a widget and the screen behind it draw the same letters. Doto came from
`https://raw.githubusercontent.com/google/fonts/main/ofl/doto/Doto[ROND,wght].ttf`, instanced and subset.

```sh
# Doto: the variable face cut to one static instance. Without --update-name-table the instance keeps the
# variable file's default name, which is Doto-Black, and UIFont would answer to the wrong name.
python3 -m fontTools.varLib.instancer "Doto[ROND,wght].ttf" wght=400 ROND=0 \
  --update-name-table -o Doto-static.ttf

# Geist (both weights) and Doto: Latin, the punctuation the widgets use, and the rupee.
python3 -m fontTools.subset <in>.ttf \
  --unicodes=U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+20B9 \
  --layout-features+=kern --no-hinting --name-IDs='*' --name-legacy \
  --notdef-outline --output-file=<out>.ttf
```

**The same four files belong in the other targets**, byte for byte, with the same SHA-256: `targets/keyboard/Fonts/` and,
on Android, `res/font/` with lowercase names (`geist_medium.ttf` and so on). Never make a second subset — two subsets of one
face differ in bytes and then one platform kerns differently from the other.

## Licences

`Geist-OFL.txt`, `BricolageGrotesque-OFL.txt` and `Doto-OFL.txt` ship beside the faces. All three are SIL Open Font License
1.1 and **none of them names a Reserved Font Name**, so subsetting and instancing do not force a rename. (The Bricolage cut
in this repository was renamed anyway, long before this work, which is why its internal name is `TailzuBricolageSemiBold`.)

## How they are loaded, and why there is no plist key

`NLookType.registerOnce` (`../NLookStyle.swift`) registers every `.ttf` and `.otf` in this folder with
`CTFontManagerRegisterFontsForURL(url, .process)` the first time a design is drawn, together with any face the app later
hooked in through the App Group (`nlook/fonts/<sha>.ttf`, written by the bridge's `writeNativeFont`). Process scope works
inside an extension, so there is no `UIAppFonts` entry in `app.config.ts` and no question about whether
`@bacons/apple-targets` would pass one through.

**A face that will not register costs nothing.** `NLookType.font` asks `UIFont(name:size:)` first and falls back to the
system face, so every design still draws — in the system face rather than in nothing. The day-1 throwaway EAS build is what
decides: it proves runtime registration in a widget, in a Live Activity and in both keyboards. If the widget extension
refuses it, the fallback is a hand-written `targets/widgets/Info.plist` with `UIAppFonts` (the plugin leaves an existing
`Info.plist` alone, which keeps the WidgetKit `NSExtension` keys).

## Known gaps

- **No Devanagari** in any of the four, so a `hi` glance falls back to the system face. Expected, not a bug.
- **Doto and Bricolage have no ₹** (U+20B9); Geist does. (An earlier line here said Bricolage had one. It does not —
  checked with fontTools against the file in this folder, which is byte-identical to the backend's.)
  A rupee in `display` or `dots` is drawn in the system face, so it appears, just not in that face. **This is already
  live, not hypothetical:** `x0.dusk` draws the question, the task and the last result in `display`, and `bots.night`'s
  `lock` root draws the task — all free words, and "Pay ₹1,200 rent" is exactly the kind of thing a task says.
  There is no "this face is not for amounts" rule, because free words can carry any character and no rule could be
  enforced on them. Core Text falls back one character at a time, as Android's text stack does, which is what the spec
  already accepts for Devanagari. Numbers the catalog itself puts in `display` and `dots` are counts and stages, and all
  four faces have digits.
- Doto is the largest of the four despite the smallest character set: a dot-matrix face is many small contours per glyph.
