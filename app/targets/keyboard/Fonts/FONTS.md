# Bundled keyboard fonts

The four type-token faces, copied **byte for byte** from IOS-WIDGETS'
`../../widgets/Fonts/`. That target makes the one canonical subset set; this
one never subsets its own, so the same bytes draw in the widget, the Live
Activity and both keyboards. `KBFonts.registerBundled()` (`../KBSkin.swift`)
registers every `.ttf` and `.otf` it finds in the extension bundle at
runtime with `CTFontManagerRegisterFontsForURL(url, .process, …)` — so **no
`UIAppFonts` entry is needed** and nothing here has to be listed in
`Info.plist`.

## What format 1 promises, and what file each token needs

The code asks for the exact **PostScript name**, not a family name. That
matters: the files' family names are "Tailzu Bricolage SemiBold", "Geist
Medium" and "Geist SemiBold", so a lookup for a family like "Bricolage
Grotesque" finds nothing, logs nothing, and silently draws the system face
on every key.

| Token | PostScript name the code asks for | File |
|---|---|---|
| `sans` | — | the system face; no file |
| `mono` | — | the system monospace; no file |
| `brand` | `Geist-Medium` below weight 600, `Geist-SemiBold` at 600 and up | `Geist-Medium.ttf`, `Geist-SemiBold.ttf` |
| `display` | `TailzuBricolageSemiBold` | `BricolageGrotesque-SemiBold.ttf` |
| `dots` | `Doto-Regular` | `Doto-Regular.ttf` |

A token whose file did not register falls back to the system face at the
same size and weight, so a build with this folder empty still draws legible
keys.

## The files, and their SHA-256

Same names and same hashes as `../../widgets/Fonts/`. If these ever differ,
one of the two was subset separately and the targets no longer draw the same
letterforms.

| File | Bytes | SHA-256 |
|---|---|---|
| `Geist-Medium.ttf` | 27,832 | `b7c2711bea921b5781f996c331d851a0478e733b71f9ab57f93ffd7d9e7d1fa6` |
| `Geist-SemiBold.ttf` | 27,712 | `f58ae1b9d8daa8dfecadc3f0ac6778acf1264cd4b094e838b71df32675893148` |
| `BricolageGrotesque-SemiBold.ttf` | 48,496 | `d792444bbe8d7d06a216e262d8139ce15e5680afb21e918acf36aeb43bcfde74` |
| `Doto-Regular.ttf` | 82,216 | `adeecbe13ff100b673fccbb4152a9aeed5d9b071ca30b6574f73e2321806c851` |

186 KB in all, inside the folder budget below. Each face's OFL 1.1 text sits
beside it (`Geist-OFL.txt`, `BricolageGrotesque-OFL.txt`, `Doto-OFL.txt`);
none of the three names a Reserved Font Name.

## Rules

- **TTF or OTF.** CoreText will not register woff2.
- **About 600 KB for the whole folder**, across every file. A keyboard
  extension is killed somewhere past 48 MB and the fonts are resident for
  the session.
- **At most 300 KB per file** — `KBFonts.register` refuses a larger one.
- **Ship each face's OFL text** beside it.
- Geist and Doto have no Devanagari, so the `hi` layout falls back to the
  system face. That is expected, not a bug.

## Hooked fonts

A skin may also carry up to two fonts in `skin.manifest.fonts`, by sha256.
Those are fetched in the one batch when the config arrives, into
`keyboard-media/font/<sha256>`, and registered from there. Nothing in this
folder is involved, and a hooked font that will not register falls to the
face's next font and then to `sans`.

## Day-1 check

The throwaway EAS build has to prove runtime registration of **these** files
on a real device, in a widget, a Live Activity and both keyboards, before
any of it is trusted in a store build. An empty folder proves nothing,
because registering zero files always "works". If the widget extension
refuses them, the fallback there is a hand-written `Info.plist` with
`UIAppFonts`; the keyboard extension has its own `Info.plist` already and
can do the same.
