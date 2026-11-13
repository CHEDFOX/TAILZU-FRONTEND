# The four faces an Android widget can draw

`setTypeface` is **not** a `@RemotableViewMethod`, so a widget's faces can only ever come from `res/font` — a file the
app downloads at runtime (`nlook/font/<sha>`) is unreachable from a RemoteViews tree, however it got there. These four
are therefore compiled in, and `android/nlook-layouts.py` writes one text fragment per (face, weight, autosize) that can
name them.

| nlook `font` | weight | `res/font` | sha256 |
|---|---|---|---|
| `brand`   | 500 | `geist_medium.ttf`                 | `b7c2711bea921b5781f996c331d851a0478e733b71f9ab57f93ffd7d9e7d1fa6` |
| `brand`   | 600+ | `geist_semibold.ttf`              | `f58ae1b9d8daa8dfecadc3f0ac6778acf1264cd4b094e838b71df32675893148` |
| `display` | 600 | `bricolage_grotesque_semibold.ttf` | `d792444bbe8d7d06a216e262d8139ce15e5680afb21e918acf36aeb43bcfde74` |
| `dots`    | 400 | `doto_regular.ttf`                 | `adeecbe13ff100b673fccbb4152a9aeed5d9b071ca30b6574f73e2321806c851` |

`sans` is the system face and `mono` is `monospace`; neither is a file.

## Why these names

The Tulmi IME (`modules/tulmi-keyboard/android`) carries the same four faces for key prints, and both modules are merged
into ONE apk. With the same resource names and byte-identical files the resource merge keeps a single copy; different
names would ship two of each. The names are pinned here and in the keyboard module, and the store-build checklist
compares all four folders (two iOS, two Android) by sha256.

## Licences

All four are SIL Open Font License 1.1. The licence text ships with the source beside the iOS copies, which are the same
bytes:

- `app/targets/widgets/Fonts/Geist-OFL.txt` — Geist Medium, Geist SemiBold
- `app/targets/widgets/Fonts/BricolageGrotesque-OFL.txt` — Bricolage Grotesque SemiBold
- `app/targets/widgets/Fonts/Doto-OFL.txt` — Doto Regular

The three OFL texts ship in the APK as `res/raw/ofl_*.txt`, identical in both Android modules. Nothing here is renamed,
so the Reserved Font Names are untouched.

## If a launcher will not honour `@font/`

It is a device-checklist item (SPEC §2.5, U) because a launcher inflates our layout in its own process. If one does not
honour it, `FACES` in `nlook-layouts.py` and the matching `when` in `NLookPlanner.textLayout` both go back to `sans`,
the kit is regenerated, and no binary feature changes: a face that cannot be drawn is exactly what the contract already
says a font that cannot register does.
