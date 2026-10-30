#!/usr/bin/env python3
"""
THE X0 WIDGET'S LAYOUTS (TailzuX0Widget.kt), generated: the twelve res/layout/tailzu_x0_{small,medium,large}_{needs,working,done,
quiet}.xml and the picker preview tailzu_x0_preview.xml, from the one spec below, so a pill, a tile, a face or the Ask bar is the
same block in every layout. Edit here, then run it and commit both:

    python3 app/modules/tulmi-bridge/android/x0-layouts.py

RemoteViews-safe views only (FrameLayout, LinearLayout, ImageView, TextView); every id is tailzu_x0_*. The Kotlin sets a view
only where its layout has it, so a block left out of a size simply is not drawn there.
"""
import os
import sys
import textwrap

RES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "src", "main", "res")
NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'


class E:
    def __init__(self, tag, attrs=None, kids=None):
        self.tag, self.attrs, self.kids = tag, dict(attrs or {}), list(kids or [])


def order(k):
    if k == "android:id":
        return (0, k)
    if k == "android:layout_width":
        return (1, k)
    if k == "android:layout_height":
        return (2, k)
    if k.startswith("android:layout_"):
        return (3, k)
    return (4, k)


def render(e, ind=0, root=False):
    pad = " " * ind
    attrs = dict(e.attrs)
    keys = sorted(attrs, key=order)
    lines = [f"{pad}<{e.tag}" + (f" {NS}" if root else "")]
    for k in keys:
        lines.append(f"{pad}    {k}=\"{attrs[k]}\"")
    if e.kids:
        lines[-1] += ">"
        out = "\n".join(lines) + "\n"
        for kid in e.kids:
            out += "\n" + render(kid, ind + 4)
        return out + f"{pad}</{e.tag}>\n"
    lines[-1] += " />"
    return "\n".join(lines) + "\n"


def a(**kw):
    out = {}
    for k, v in kw.items():
        if v is None:
            continue
        out["android:" + k] = v
    return out


def dp(n):
    return f"{n:g}dp"


def ID(n):
    return f"@+id/tailzu_x0_{n}"


COLORS = {"ink": "@color/tailzu_widget_ink", "meta": "@color/tailzu_widget_meta", "dim": "@color/tailzu_widget_dim",
          "ground": "@color/tailzu_widget_ground"}


def text(id_, size, color="ink", weight=400, lines=1, w="wrap_content", h="wrap_content", **kw):
    at = a(id=ID(id_) if id_ else None, layout_width=w, layout_height=h, textSize=dp(size), textColor=COLORS[color],
           maxLines=str(lines), ellipsize="end", includeFontPadding="false")
    if weight == 500:
        at.update(a(fontFamily="sans-serif-medium"))
    if weight == 700:
        at.update(a(textStyle="bold"))
    at.update(a(**kw))
    return E("TextView", at)


def img(id_, w, h, src, **kw):
    at = a(id=ID(id_) if id_ else None, layout_width=w if isinstance(w, str) else dp(w),
           layout_height=h if isinstance(h, str) else dp(h), src=src, contentDescription="@null",
           importantForAccessibility="no")
    at.update(a(**kw))
    return E("ImageView", at)


def frame(id_, w, h, kids, **kw):
    at = a(id=ID(id_) if id_ else None, layout_width=w if isinstance(w, str) else dp(w),
           layout_height=h if isinstance(h, str) else dp(h))
    at.update(a(**kw))
    return E("FrameLayout", at, kids)


def row(kids, id_=None, w="match_parent", h="wrap_content", gravity="center_vertical", **kw):
    at = a(id=ID(id_) if id_ else None, layout_width=w, layout_height=h, orientation="horizontal", gravity=gravity)
    at.update(a(**kw))
    return E("LinearLayout", at, kids)


def col(kids, id_=None, w="match_parent", h="wrap_content", **kw):
    at = a(id=ID(id_) if id_ else None, layout_width=w, layout_height=h, orientation="vertical")
    at.update(a(**kw))
    return E("LinearLayout", at, kids)


def vspace():
    return E("FrameLayout", a(layout_width="match_parent", layout_height="0dp", layout_weight="1"))


def hspace(w=None):
    if w is not None:
        return E("FrameLayout", a(layout_width=dp(w), layout_height="1dp"))
    return E("FrameLayout", a(layout_width="0dp", layout_height="1dp", layout_weight="1"))


def ground():
    return img("ground", "match_parent", "match_parent", "@drawable/tailzu_widget_ground", scaleType="fitXY")


def root(kids):
    return E("FrameLayout", a(id="@android:id/background", layout_width="match_parent", layout_height="match_parent"),
             [ground()] + kids)


def body(kids, **kw):
    return col(kids, h="match_parent", padding="16dp", **kw)


def face(id_, size, **kw):
    return img(id_, size, size, "@drawable/tailzu_x0_head_tailzu", scaleType="fitCenter", **kw)


def dot(id_, size=6, **kw):
    return img(id_, size, size, "@drawable/tailzu_x0_dot", **kw)


def pill(n, w="wrap_content", h=34, size=13, full=False, **kw):
    return frame(f"p{n}", w, h, [
        img(f"p{n}_bg", "match_parent", "match_parent", "@drawable/tailzu_widget_pill", scaleType="fitXY"),
        img(f"p{n}_ring", "match_parent", "match_parent", "@drawable/tailzu_widget_pill_ring", scaleType="fitXY"),
        text(f"p{n}_text", size, "ground", 500, w="match_parent" if full else "wrap_content", h="match_parent",
             gravity="center", paddingStart="16dp", paddingEnd="16dp"),
    ], visibility="gone", **kw)


def pills_row(**kw):
    return row([
        pill(0, layout_marginEnd="6dp"), pill(1, layout_marginEnd="6dp"), pill(2, layout_marginEnd="6dp"),
        text("decide", 13, "meta", 500, h="34dp", gravity="center_vertical", paddingStart="4dp", paddingEnd="4dp",
             visibility="gone"),
    ], id_="pills", **kw)


def state(**kw):
    return text("state", 13, "meta", 500, visibility="gone", **kw)


def check(size, mark):
    return frame("check", size, size, [
        img("check_disc", "match_parent", "match_parent", "@drawable/tailzu_x0_dot", scaleType="fitXY"),
        img("check_mark", mark, mark, "@drawable/tailzu_wi_check", layout_gravity="center"),
    ], visibility="gone")


def bar(h, label=None, **kw):
    kids = [img("bar", "match_parent", h, "@drawable/tailzu_widget_pill", scaleType="fitXY")]
    if label:
        kids.append(row([text(f"stage{i}", label, "dim", 500, w="0dp", layout_weight="1", ellipsize="none")
                         for i in range(6)], id_="stages", layout_marginTop="5dp"))
    return col(kids, id_="track", **kw)


def chip():
    return frame("chip", "wrap_content", 28, [
        img("chip_bg", "match_parent", "match_parent", "@drawable/tailzu_widget_pill", scaleType="fitXY"),
        text("chip_text", 12.5, "ink", 500, h="match_parent", gravity="center", paddingStart="10dp", paddingEnd="10dp"),
    ], layout_marginStart="8dp", visibility="gone")


def crew(**kw):
    def seat(i):
        return frame(f"crew{i}", 26, 26, [
            img(f"crew{i}_disc", "match_parent", "match_parent", "@drawable/tailzu_x0_dot", scaleType="fitXY"),
            face(f"crew{i}_face", 22, layout_gravity="center"),
        ], layout_marginStart=dp(i * 18), visibility="gone")
    return frame(None, "match_parent", "wrap_content", [
        row([
            frame(None, "wrap_content", "wrap_content", [seat(0), seat(1), seat(2)]),
            text("crew_name", 12.5, "ink", 500, layout_marginStart="8dp"),
            text("crew_line", 12.5, "meta", w="0dp", layout_weight="1", layout_marginStart="4dp"),
        ], id_="crew", visibility="gone"),
        text("summary", 12.5, "meta", w="match_parent", layout_gravity="center_vertical", visibility="gone"),
    ], **kw)


def week(**kw):
    beads = [img(f"bead{i}", 7, 7, "@drawable/tailzu_x0_dot", layout_marginEnd="4dp", visibility="gone") for i in range(5)]
    return row(beads + [
        img("bead_open", 7, 7, "@drawable/tailzu_x0_ring"),
        text("week_text", 12.5, "meta", w="0dp", layout_weight="1", layout_marginStart="8dp"),
    ], id_="week", visibility="gone", **kw)


def hello_block():
    return [text("hello", 14, "meta", visibility="gone"), week(layout_marginTop="5dp")]


def tiles(**kw):
    def tile(i):
        return frame(f"tile{i}", "0dp", 64, [
            img(f"tile{i}_bg", "match_parent", "match_parent", "@drawable/tailzu_x0_tile", scaleType="fitXY"),
            row([
                face(f"tile{i}_face", 36),
                col([
                    text(f"tile{i}_name", 13.5, "ink", 500),
                    row([
                        dot(f"tile{i}_dot", layout_marginEnd="4dp", visibility="gone"),
                        text(f"tile{i}_line", 11.5, "meta", w="0dp", layout_weight="1"),
                    ], layout_marginTop="2dp"),
                ], w="0dp", layout_weight="1", layout_marginStart="10dp"),
            ], h="match_parent", paddingStart="12dp", paddingEnd="10dp"),
        ], layout_weight="1", visibility="invisible")
    return col([
        row([tile(0), hspace(8), tile(1)], id_="tiles_row1"),
        row([tile(2), hspace(8), tile(3)], id_="tiles_row2", layout_marginTop="8dp"),
    ], id_="tiles", visibility="gone", **kw)


def ask(h=44, size=14, key=36, **kw):
    return frame("ask", "match_parent", h, [
        img("ask_bg", "match_parent", "match_parent", "@drawable/tailzu_widget_pill", scaleType="fitXY"),
        img("ask_ring", "match_parent", "match_parent", "@drawable/tailzu_widget_pill_ring", scaleType="fitXY"),
        row([
            text("ask_text", size, "meta", w="0dp", layout_weight="1", text="@string/tailzu_x0_ask"),
            img("ask_key", key, key, "@drawable/tailzu_x0_peek"),
        ], h="match_parent", paddingStart="18dp", paddingEnd=dp((h - key) / 2)),
    ], **kw)


def card(kids, **kw):
    return frame("card", "match_parent", "wrap_content", [
        img("card_bg", "match_parent", "match_parent", "@drawable/tailzu_x0_card", scaleType="fitXY"),
        col(kids, padding="14dp"),
    ], **kw)


def needs_label(face_size=None):
    kids = [dot("dot", layout_marginEnd="6dp"),
            text("label", 11, "ink", 700, w="0dp", layout_weight="1", letterSpacing="0.04")]
    if face_size:
        kids.append(face("face", face_size, layout_marginStart="8dp"))
    return row(kids)


# ---------------------------------------------------------------------------------------------------------- the layouts

L = {}

L["small_needs"] = ("2x2, something needs you: the bot's face, name and \"needs you\"; its question; the answers stacked, the first "
                    "filled (answered in place through the widgets' own token), or how a pressed one went.", root([body([
    row([
        face("face", 34),
        col([
            text("name", 13, "ink", 500),
            row([dot("dot", layout_marginEnd="5dp"), text("status", 12, "meta")], layout_marginTop="1dp"),
        ], w="0dp", layout_weight="1", layout_marginStart="8dp"),
    ], id_="head"),
    text("question", 14, "ink", 500, lines=3, w="match_parent", layout_marginTop="10dp", lineSpacingExtra="2dp"),
    vspace(),
    pill(0, w="match_parent", full=True),
    pill(1, w="match_parent", full=True, layout_marginTop="6dp"),
    state(),
])]))

L["small_working"] = ("2x2, bots working: the job's bot, its stage of the whole (3/5), the task, the bot and stage, the stage bar, "
                      "and how many others are at work.", root([body([
    row([face("face", 34), hspace(), text("count", 12, "ink", 700)]),
    text("title", 18, "ink", 700, lines=2, w="match_parent", layout_marginTop="9dp", lineSpacingExtra="1dp"),
    text("sub", 11.5, "meta", w="match_parent", layout_marginTop="1dp"),
    vspace(),
    bar(6),
    row([face("more_face", 16), text("more_text", 10.5, "meta", w="0dp", layout_weight="1", layout_marginStart="5dp")],
        id_="more", layout_marginTop="8dp", visibility="gone"),
])]))

L["small_done"] = ("2x2, something just finished: the bot, a check, what it finished, the bot and how long it took, and See the PR "
                   "when there is one.", root([body([
    row([face("face", 34), hspace(), check(24, 14)]),
    text("title", 16, "ink", 700, lines=3, w="match_parent", layout_marginTop="9dp", lineSpacingExtra="1dp"),
    text("sub", 11.5, "meta", w="match_parent", layout_marginTop="2dp"),
    vspace(),
    pill(0, w="match_parent", full=True),
])]))

L["small_quiet"] = ("2x2, all quiet: the painted X0 bot hanging off the top, the peek-bot key (Ask), the greeting and the day's line.",
                    root([
    img("hang", 104, 62, "@drawable/tailzu_x0_hang", layout_gravity="top|start", layout_marginStart="12dp",
        scaleType="fitStart"),
    img("ask_key", 36, 36, "@drawable/tailzu_x0_peek", layout_gravity="top|end", layout_marginTop="14dp",
        layout_marginEnd="14dp"),
    col([
        text("hello", 12.5, "meta", w="match_parent", visibility="gone"),
        text("line", 16, "ink", 700, lines=3, w="match_parent", layout_marginTop="2dp", lineSpacingExtra="1dp"),
    ], h="match_parent", gravity="bottom", padding="16dp"),
]))

L["medium_needs"] = ("4x2, something needs you: the bot's big face (and what it is doing, when it is also at work); NEEDS YOU and "
                     "the bot; the question; the answers in a row and You decide, or how a pressed one went.", root([
    row([
        col([
            face("face", 56),
            row([dot("lead_dot", layout_marginEnd="4dp"), text("lead_text", 10.5, "meta", lines=2, w="0dp", layout_weight="1")],
                id_="lead", gravity="top", layout_marginTop="4dp", visibility="gone"),
        ], w="64dp"),
        col([
            needs_label(),
            text("question", 16, "ink", 500, lines=3, w="match_parent", layout_marginTop="5dp", lineSpacingExtra="2dp"),
            vspace(),
            pills_row(),
            state(),
        ], w="0dp", h="match_parent", layout_weight="1", layout_marginStart="12dp"),
    ], h="match_parent", gravity="top", padding="16dp"),
]))

L["medium_working"] = ("4x2, bots working: the job's bot, task, bot and step; minutes so far; the stage bar with the stages' names; "
                       "the others at work, their faces and what the first is doing.", root([body([
    row([
        face("face", 48),
        col([text("title", 20, "ink", 700, w="match_parent"), text("sub", 13, "meta", w="match_parent", layout_marginTop="1dp")],
            w="0dp", layout_weight="1", layout_marginStart="12dp"),
        chip(),
    ]),
    bar(8, label=10.5, layout_marginTop="14dp"),
    vspace(),
    crew(),
])]))

L["medium_done"] = ("4x2, something just finished: the bot, what it finished, how long it took and its PR, a check; See the PR; "
                    "who else is at work.", root([body([
    row([
        face("face", 48),
        col([text("title", 20, "ink", 700, lines=2, w="match_parent"),
             text("sub", 13, "meta", w="match_parent", layout_marginTop="1dp")],
            w="0dp", layout_weight="1", layout_marginStart="12dp"),
        check(28, 16),
    ], gravity="top"),
    vspace(),
    pill(0),
    crew(layout_marginTop="10dp"),
])]))

L["medium_quiet"] = ("4x2, all quiet: the greeting, the day's line, Ask any bot with the peek-bot key; the X0 bot hanging on at the "
                     "top. Also the widget as placed, before the first draw.", root([
    img("hang", 112, 67, "@drawable/tailzu_x0_hang", layout_gravity="top|end", layout_marginEnd="20dp", scaleType="fitStart"),
    body([
        text("hello", 13, "meta", w="match_parent", layout_marginEnd="116dp", layout_marginTop="2dp", visibility="gone"),
        text("line", 20, "ink", 700, lines=2, w="match_parent", layout_marginEnd="116dp", layout_marginTop="4dp",
             lineSpacingExtra="1dp"),
        vspace(),
        ask(),
    ]),
]))

L["large_needs"] = ("4x4, something needs you: the greeting and the week's beads; the question as a card (NEEDS YOU, the bot's face, "
                    "the answers and You decide); the bots as Home's tiles; Ask.", root([body(hello_block() + [
    card([
        needs_label(28),
        text("question", 16, "ink", 500, lines=3, w="match_parent", layout_marginTop="6dp", lineSpacingExtra="2dp"),
        pills_row(layout_marginTop="10dp"),
        state(layout_marginTop="10dp"),
    ], layout_marginTop="12dp"),
    vspace(),
    tiles(),
    ask(layout_marginTop="10dp"),
])]))

L["large_working"] = ("4x4, bots working: the greeting and the week's beads; the job as a card (face, task, bot and stage, the stage "
                      "bar with names, step and minutes); the bots as Home's tiles; Ask.", root([body(hello_block() + [
    card([
        row([
            face("face", 44),
            col([text("title", 18, "ink", 700, w="match_parent"), text("sub", 12.5, "meta", w="match_parent", layout_marginTop="1dp")],
                w="0dp", layout_weight="1", layout_marginStart="12dp"),
        ]),
        bar(6, label=10, layout_marginTop="12dp"),
        row([text("step", 12.5, "ink", 700), text("minin", 12.5, "meta", w="0dp", layout_weight="1")],
            id_="steps", layout_marginTop="10dp"),
    ], layout_marginTop="12dp"),
    vspace(),
    tiles(),
    ask(layout_marginTop="10dp"),
])]))

L["large_done"] = ("4x4, something just finished: the greeting and the week's beads; the finished thing as a card (face, what, how "
                   "long, its PR, a check, See the PR); the bots as Home's tiles; Ask.", root([body(hello_block() + [
    card([
        row([
            face("face", 44),
            col([text("title", 18, "ink", 700, lines=2, w="match_parent"),
                 text("sub", 12.5, "meta", w="match_parent", layout_marginTop="1dp")],
                w="0dp", layout_weight="1", layout_marginStart="12dp"),
            check(28, 16),
        ], gravity="top"),
        pill(0, layout_marginTop="12dp"),
    ], layout_marginTop="12dp"),
    vspace(),
    tiles(),
    ask(layout_marginTop="10dp"),
])]))

L["large_quiet"] = ("4x4, all quiet: the X0 bot hanging on; the greeting, the day's line, the week's beads; the bots as Home's tiles; "
                    "Ask with the peek-bot key.", root([
    img("hang", 118, 70, "@drawable/tailzu_x0_hang", layout_gravity="top|end", layout_marginEnd="24dp", scaleType="fitStart"),
    body([
        text("hello", 14, "meta", w="match_parent", layout_marginEnd="128dp", layout_marginTop="4dp", visibility="gone"),
        text("line", 26, "ink", 700, lines=3, w="match_parent", layout_marginEnd="128dp", layout_marginTop="6dp",
             lineSpacingExtra="3dp"),
        week(layout_marginTop="14dp"),
        vspace(),
        tiles(),
        ask(46, 15, 38, layout_marginTop="10dp"),
    ]),
]))



def seg(src, **kw):
    return img(None, "0dp", 8, src, layout_weight="1", scaleType="fitXY", **kw)


def plain(size, color, weight, string, **kw):
    t = text(None, size, color, weight, text=f"@string/{string}", **kw)
    return t


def pface(src, size, **kw):
    return img(None, size, size, f"@drawable/{src}", scaleType="fitCenter", **kw)


PREVIEW = E("FrameLayout", a(id="@android:id/background", layout_width="match_parent", layout_height="match_parent",
                             background="@drawable/tailzu_widget_ground"), [
    body([
        row([
            pface("tailzu_x0_head_code", 48),
            col([plain(20, "ink", 700, "tailzu_x0_preview_task"),
                 plain(13, "meta", 400, "tailzu_x0_preview_sub", layout_marginTop="1dp")],
                w="0dp", layout_weight="1", layout_marginStart="12dp"),
            E("TextView", {**text(None, 12.5, "ink", 500, h="28dp", gravity="center", paddingStart="10dp", paddingEnd="10dp",
                                   background="@drawable/tailzu_widget_pill", backgroundTint="@color/tailzu_widget_surface",
                                   text="@string/tailzu_x0_preview_min").attrs,
                           "android:textColor": "@color/tailzu_x0_preview_code", "android:layout_marginStart": "8dp"}),
        ]),
        row([
            seg("@drawable/tailzu_x0_preview_done", layout_marginEnd="3dp"),
            seg("@drawable/tailzu_x0_preview_done", layout_marginEnd="3dp"),
            seg("@drawable/tailzu_x0_preview_now", layout_marginEnd="3dp"),
            seg("@drawable/tailzu_x0_preview_todo", layout_marginEnd="3dp"),
            seg("@drawable/tailzu_x0_preview_todo"),
        ], layout_marginTop="14dp"),
        row([
            plain(10.5, "meta", 500, "tailzu_x0_preview_stage1", w="0dp", layout_weight="1", ellipsize="none"),
            plain(10.5, "meta", 500, "tailzu_x0_preview_stage2", w="0dp", layout_weight="1", ellipsize="none"),
            plain(10.5, "ink", 700, "tailzu_x0_preview_stage3", w="0dp", layout_weight="1", ellipsize="none"),
            plain(10.5, "dim", 500, "tailzu_x0_preview_stage4", w="0dp", layout_weight="1", ellipsize="none"),
            plain(10.5, "dim", 500, "tailzu_x0_preview_stage5", w="0dp", layout_weight="1", ellipsize="none"),
        ], layout_marginTop="5dp"),
        vspace(),
        row([
            frame(None, "wrap_content", "wrap_content", [
                pface("tailzu_x0_head_travel", 24),
                pface("tailzu_x0_head_keybot", 24, layout_marginStart="18dp"),
                pface("tailzu_x0_head_plan", 24, layout_marginStart="36dp"),
            ]),
            plain(12.5, "ink", 500, "tailzu_x0_preview_crew", layout_marginStart="8dp"),
            E("TextView", {**text(None, 12.5, "meta", 400, w="0dp", layout_weight="1", layout_marginStart="4dp",
                                   text="@string/tailzu_x0_preview_crew_line").attrs,
                           "android:textColor": "@color/tailzu_x0_preview_travel"}),
        ]),
    ]),
])

HEAD = """<?xml version="1.0" encoding="utf-8"?>
<!--
{what}

  Generated with the other tailzu_x0_* layouts from one spec (android/x0-layouts.py), so a pill, a tile or a face is the same
  block everywhere. Every word, colour, face and tap is set at run time from the glance the app wrote (x0.glance); what is here
  is the theme's, for the moment before the first draw. RemoteViews-safe views only. The root carries @android:id/background:
  Android 12+ rounds the widget on it and animates a tap from it.
-->
"""

for name, (what, tree) in L.items():
    path = os.path.join(RES, "layout", f"tailzu_x0_{name}.xml")
    with open(path, "w") as f:
        lines = textwrap.wrap("THE X0 WIDGET (TailzuX0Widget.kt), " + what, width=126, initial_indent="  ", subsequent_indent="  ")
        f.write(HEAD.format(what="\n".join(lines)) + render(tree, 0, root=True))
print(len(L), "layouts")

PREVIEW_HEAD = """<?xml version="1.0" encoding="utf-8"?>
<!--
  What the widget picker shows on Android 12+ before X0 is placed (previewLayout): the 4x2 with Code bot at work on the cart fix,
  step 3 of 5, and the crew's faces while Travel bot finds a hotel. Fixed, because the picker cannot read what the app wrote; the
  colours follow the phone's light or dark theme. Before Android 12 the picker shows tailzu_x0_preview_image instead.
  Generated with the tailzu_x0_* layouts (android/x0-layouts.py).
-->
"""
with open(os.path.join(RES, "layout", "tailzu_x0_preview.xml"), "w") as f:
    f.write(PREVIEW_HEAD + render(PREVIEW, 0, root=True))
