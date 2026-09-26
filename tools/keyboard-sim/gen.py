#!/usr/bin/env python3
"""Build the simulator's Swift sources from the keyboard's REAL code.

    gen.py <SDUIRenderer.swift> <KeyboardTelemetry.swift> <config.json> <outdir>

Lifts, verbatim, out of SDUIRenderer.swift:
  - KeyHitButton, KeyRowStackView and KeyPlaneView (the whole touch plane);
  - the renderer functions on the keystroke path: planeCommit, the tray
    retract, the insertKey case of the action interpreter, the accent map,
    and everything in the "Lift keys" section (space / return / onPress keys).
Then the Counter enum out of KeyboardTelemetry.swift, and the layout and
flags out of the config the backend sends.

The only edits are mechanical: `@objc` is dropped and `#selector(f(_:))`
becomes a closure calling the same method, because Linux has no Objective-C
runtime. Every line of logic is the shipped line.
"""
import json, re, sys, pathlib

src_path, tel_path, cfg_path, out = sys.argv[1:5]
src = pathlib.Path(src_path).read_text()
tel = pathlib.Path(tel_path).read_text()
cfg = json.loads(pathlib.Path(cfg_path).read_text())
out = pathlib.Path(out)
out.mkdir(parents=True, exist_ok=True)


def block_end(text, open_idx):
    """Index just past the brace that closes the one at open_idx, skipping
    comments and string literals."""
    i, depth, n = open_idx, 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            i = text.index("\n", i)
            continue
        if text.startswith("/*", i):
            i = text.index("*/", i) + 2
            continue
        if text.startswith('"""', i):
            i = text.index('"""', i + 3) + 3
            continue
        if c == '"':
            i += 1
            while text[i] != '"':
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise SystemExit("unbalanced braces")


def decl(anchor, required=True):
    """The declaration starting at `anchor`, through its closing brace, with
    the doc comments directly above it."""
    at = src.find(anchor)
    if at < 0:
        if required:
            raise SystemExit(f"not found: {anchor}")
        return ""
    line0 = src.rfind("\n", 0, at) + 1
    end = block_end(src, src.index("{", at))
    return src[line0:end] + "\n"


def objc_free(code):
    code = re.sub(r"@objc\s+", "", code)
    code = re.sub(r"#selector\((\w+)\(_:\)\)", r"{ [unowned self] b, _ in self.\1(b) }", code)
    code = re.sub(r"#selector\((\w+)\(_:event:\)\)", r"{ [unowned self] b, e in self.\1(b, event: e) }", code)
    return code


have = {}
parts = []
parts.append(decl("final class KeyHitButton: UIButton {"))
parts.append(decl("final class KeyRowStackView: UIStackView {"))
parts.append(decl("final class KeyPlaneView: UIView {"))

r = []  # renderer members lifted into the stub
r.append(decl("fileprivate func planeCommit(char: String) {"))
retract = decl("fileprivate func planeRetractDownCommit() {", required=False)
have["RETRACT"] = bool(retract)
r.append(retract)
# The accent map: kb.accents from the config (K40+), else the built-in map.
acc = src.find("  /// kb.accents — the long-press alternates")
if acc >= 0:
    end = src.index("\n  ]\n", src.index("private static let builtInAccents", acc)) + len("\n  ]\n")
    r.append(src[acc:end])
    have["CONFIG_ACCENTS"] = True
else:
    r.append(decl("private var accentMap: [String: [String]] {"))
m = re.search(r"\n(\s*private var lastKeyInsert: String\?)\n", src)
have["LASTKEYINSERT"] = bool(m)
if m:
    r.append(m.group(1) + "\n")

# The insertKey case of the action interpreter, wrapped as a method.
a = src.index("    case .insertKey(let char):\n")
b = src.index("    case .deleteBackward:\n", a)
body = src[a + len("    case .insertKey(let char):\n"):b]
r.append("  func insertKeyCase(_ char: String) {\n"
         "    let proxy = host?.hostTextDocumentProxy\n" + body + "  }\n")

# The lift-key section: from its MARK to the next MARK.
lk = src.find("  // MARK: - Lift keys")
have["BINDLIFT"] = lk >= 0
if lk >= 0:
    nxt = src.index("  // MARK:", lk + 10)
    r.append(objc_free(src[lk:nxt]))

# The non-visual half of keyTouchDown, when it has been split out (K40+).
# It lives in the lift-key section, which is lifted whole above.
have["KEYDOWN_ROLLOVER"] = "fileprivate func keyDownRollover(_ btn: UIButton)" in src

have["ROLEREACH"] = "var roleReach: CGFloat" in src

counter = re.search(r"  enum Counter: String \{.*?\n  \}\n", tel, re.S).group(0)

template = (pathlib.Path(__file__).parent / "Renderer.swift.in").read_text()
gen = "import Foundation\n\n" + "".join(parts) + "\n" + template \
    .replace("//@@RENDERER@@", "".join(r)) \
    .replace("//@@COUNTER@@", counter)
(out / "Gen.swift").write_text(gen)

# ---------------------------------------------------------------- layout
# Mirrors the renderer's stacks: the root Container is a vertical stack with
# padding and a gap; each Row is a horizontal stack whose children with a flex
# share the width left after gaps and fixed widths, in proportion to flex.
state = {"state.appearance": "dark", "state.layoutId": "en", "state.status": "",
         "state.secured": False, "state.hasMultipleKeyboards": True}


def visible(n):
    v = n.get("visibleIf")
    return True if not v else cond(v)


def cond(v):
    op, arg = next(iter(v.items()))
    if op == "any":
        return any(cond(x) for x in arg)
    if op == "all":
        return all(cond(x) for x in arg)
    if op == "eq":
        return state.get(arg[0]) == arg[1]
    if op == "neq":
        return state.get(arg[0]) != arg[1]
    if op == "truthy":
        return bool(state.get(arg))
    if op == "falsy":
        return not state.get(arg)
    raise SystemExit(f"visibleIf op {op}")


WIDTH = 393.0
root = cfg["root"]
rs = root.get("style", {})
pl, pr, pt = rs.get("paddingLeft", 0), rs.get("paddingRight", 0), rs.get("paddingTop", 0)
pb, rgap = rs.get("paddingBottom", 0), rs.get("gap", 0)
rows, y = [], pt
for row in root["children"]:
    if not visible(row):
        continue
    st = row.get("style", {})
    h, pad, gap = st.get("height", 44), st.get("padding", 0), st.get("gap", 5)
    inner_w, inner_h = WIDTH - pl - pr - 2 * pad, h - 2 * pad
    kids = [k for k in row.get("children", []) if visible(k)]
    fixed = sum(k.get("style", {}).get("width", 0) for k in kids
                if "width" in k.get("style", {}))
    flex = sum(k.get("style", {}).get("flex", 0) for k in kids
               if "width" not in k.get("style", {}))
    per = (inner_w - gap * (len(kids) - 1) - fixed) / flex if flex else 0
    x, items = pad, []
    for k in kids:
        ks = k.get("style", {})
        w = ks["width"] if "width" in ks else ks.get("flex", 0) * per
        kind = k["type"]
        ch = (k.get("props") or {}).get("char", "")
        if kind == "LetterKey" and (k.get("bind") or {}).get("content") == "tone":
            kind = "ToneKey"
        elif kind == "LetterKey" and "onPress" in (k.get("on") or {}):
            kind = "LayerKey"
        items.append((kind, ch, x, pad, w, inner_h))
        x += w + gap
    rows.append((pl, y, WIDTH - pl - pr, h, items))
    y += h + rgap
height = y - rgap + pb

sw = ["// Generated by gen.py from the backend's keyboard config. Do not edit.",
      f"let KB_WIDTH: CGFloat = {WIDTH}", f"let KB_HEIGHT: CGFloat = {height}",
      "struct ItemSpec { let kind: String; let ch: String; let x, y, w, h: CGFloat }",
      "struct RowSpec { let x, y, w, h: CGFloat; let items: [ItemSpec] }",
      "let ROWS: [RowSpec] = ["]
for (rx, ry, rw, rh, items) in rows:
    its = ", ".join(f'ItemSpec(kind: "{k}", ch: {json.dumps(c)}, x: {x:.4f}, y: {yy:.4f}, w: {w:.4f}, h: {hh:.4f})'
                    for (k, c, x, yy, w, hh) in items)
    sw.append(f"  RowSpec(x: {rx}, y: {ry}, w: {rw}, h: {rh}, items: [{its}]),")
sw.append("]")
flags = cfg.get("flags", {})
num = {k: v for k, v in flags.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
bools = {k: v for k, v in flags.items() if isinstance(v, bool)}
sw.append("var FLAG_NUM: [String: Double] = [" + ", ".join(f'"{k}": {float(v)}' for k, v in sorted(num.items())) + "]")
sw.append("var FLAG_BOOL: [String: Bool] = [" + ", ".join(f'"{k}": {"true" if v else "false"}' for k, v in sorted(bools.items())) + "]")
big = flags.get("kb.touch.bigrams", {}) or {}
sw.append("let BIGRAMS: [String: String] = [" + ", ".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in sorted(big.items())) + "]")
(out / "Layout.swift").write_text("import Foundation\n" + "\n".join(sw) + "\n")

flags_d = " ".join(f"-D HAS_{k}" for k, v in have.items() if v)
(out / "defines").write_text(flags_d + "\n")
print(f"generated {out}: {height:.0f}pt keyboard, {sum(len(r[4]) for r in rows)} views, {flags_d}")
