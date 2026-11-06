/**
 * MentionField — a message field where "@" picks a person and "/" a bot's thing (types.ts MentionFieldProps, component
 * "MentionField"; section 3i): the space's composer, in its bot's thought.
 *
 * It owns its words, its chips (a person, a thing: 28 high, round, a light fill, with an x) and the list over the words:
 * People ("@", each with their own tiny bot from the row's `bot`, never a letter: bots/PersonBot.tsx), the person's bots ("/",
 * each with its dot, then `tools` under a line), and a bot's things (fetched from
 * `thingsPath` with the app's own signed-in call). The rules are mentionCore.ts's. Every change writes a MentionDraft to
 * `draftPath` (the words without the chips); the return key and the send button run on.onSubmit, after "@name" typed out
 * is turned into its chip (or, with two such people, their list opens and nothing is sent). When the screen clears
 * `draftPath` the field empties itself, chips too. The list is drawn in the field, over the words, never outside it: the
 * box it sits in grows with it (Android hands no touch to what is drawn outside its parent).
 *
 * In a footer, it tells the footer when it has the keyboard (as TextField does), so the footer rises over it; left empty
 * when the keyboard goes, it closes the thought it is in (bots/thought.ts).
 *
 *   { type: "MentionField", props: { life, placeholder, draftPath, people, bots, thingsPath, tools?, words, maxLength?,
 *     autoFocus? }, on: { onSubmit } }
 */
import React, { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as K from "../knobs";
import type { CompProps } from "./props";
import { runAction } from "../actions";
import { callEndpoint } from "../client";
import type { ActionRef } from "../types";
import { FooterField } from "./Screen";
import { ThoughtContext } from "../bots/thought";
import { PersonBotView } from "../bots/PersonBot";
import { readPersonBot } from "../bots/personBotCore";
import {
  EMPTY, atSubmit, backspace, canSend, draftOf, escape, filterBots, filterPeople, fromDraft, isEmptyDraft, pickBot, pickPerson, pickThing, pickTool, typed,
  type BotRef, type MentionState, type Person, type Thing,
} from "./mentionCore";

const INK = "#0a0a0a", META = "#5c5c5c", IDLE = "#8a8a8a", LINE = "#e6e6e6";
const FACE = "Tailzu Geist", FACE_SEMI = "Tailzu Geist SemiBold";
/** The web (the render check, Expo web) rings a focused field; the box around it is its frame. */
const WEB_FIELD = (Platform.OS === "web" ? { outlineStyle: "none" } : null) as object | null;

/**
 * A row's person: their own tiny bot (the row's `bot`, the server's look for them). A row without one (a server from before
 * people were bots) gets a plain circle in a colour of the person's own (the same name, the same colour): never a letter.
 */
type Row = Person & { bot?: { seed: string; avatar: string; color: string } };
const DOTS = ["#6E4A6B", "#4F7A3A", "#A9573A", "#3E6E8E", "#8F6A1F", "#2F5D50", "#7A6440", "#5F6B6E"];
function dotColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return DOTS[h % DOTS.length]!;
}

/** The look a row carries, when it carries one that names a person and a colour. */
function rowBot(b: unknown): Row["bot"] {
  if (!b || typeof b !== "object") return undefined;
  const o = b as Record<string, unknown>;
  if (typeof o.seed !== "string" || typeof o.color !== "string") return undefined;
  return { seed: o.seed, avatar: typeof o.avatar === "string" ? o.avatar : "", color: o.color };
}

export const MentionField = ({ props, store, ctx, fire }: CompProps): React.ReactElement => {
  const draftPath = typeof props?.draftPath === "string" ? props.draftPath : "draft";
  const people: Row[] = Array.isArray(props?.people)
    ? props.people.filter((p: any) => p && typeof p.id === "string").map((p: any) => ({ id: p.id, name: String(p.name ?? ""), bot: rowBot(p.bot) }))
    : [];
  const bots: BotRef[] = Array.isArray(props?.bots) ? props.bots.filter((b: any) => b && typeof b.slug === "string") : [];
  const tools: Array<{ id: string; label: string; action: ActionRef }> = Array.isArray(props?.tools) ? props.tools : [];
  const words = { people: "People", bots: "Share from a bot", empty: "Nothing here yet", ...(props?.words ?? {}) };
  const thingsPath = typeof props?.thingsPath === "string" ? props.thingsPath : "";

  // The field, from what the screen's draft says (a box opened again with words in it).
  const [st, setSt] = useState<MentionState>(() => fromDraft(store.get(draftPath)));
  const written = useRef<string>(JSON.stringify(draftOf(st)));
  const input = useRef<TextInput>(null);
  const caret = useRef(st.text.length);
  const focused = useRef(false);
  const footer = useContext(FooterField);
  const thought = useContext(ThoughtContext);

  const stRef = useRef(st);
  stRef.current = st;
  const update = (next: MentionState) => {
    setSt(next);
    const d = draftOf(next);
    const json = JSON.stringify(d);
    if (json !== written.current) { written.current = json; store.set(draftPath, d); }
  };

  // The screen cleared the draft (sent): the field empties itself, chips and all. Only a change that is not the field's
  // own counts (a bot picked from "/" leaves the draft empty while its things are open).
  const now = store.get(draftPath);
  useEffect(() => {
    if (JSON.stringify(draftOf(fromDraft(now))) === written.current || !isEmptyDraft(now)) return;
    written.current = JSON.stringify(draftOf(EMPTY));
    setSt(EMPTY);
  });

  // A bot's things, fetched when it is picked.
  const [things, setThings] = useState<{ bot: string; items: Thing[] | null; failed: boolean }>({ bot: "", items: null, failed: false });
  const menuBot = st.menu?.kind === "things" ? st.menu.bot : "";
  useEffect(() => {
    if (!menuBot || !thingsPath) return;
    let live = true;
    setThings({ bot: menuBot, items: null, failed: false });
    callEndpoint("GET", thingsPath.replace(":bot", encodeURIComponent(menuBot)))
      .then((r) => {
        const items: Thing[] = Array.isArray(r?.items) ? r.items.filter((i: any) => i && typeof i.id === "string").map((i: any) => ({ id: i.id, title: String(i.title ?? ""), line: String(i.line ?? "") })) : [];
        if (live) setThings({ bot: menuBot, items, failed: false });
      })
      .catch(() => { if (live) setThings({ bot: menuBot, items: [], failed: true }); });
    return () => { live = false; };
  }, [menuBot, thingsPath]);

  const submit = () => {
    const r = atSubmit(st, people);
    if (!r.send) { update(r.state); input.current?.focus(); return; }
    update(r.state);
    fire("onSubmit", draftOf(r.state));
  };

  // ---- the list over the words
  const row = (key: string, onPress: () => void, body: React.ReactNode, h = 48) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ height: h, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: pressed ? "#f2f2f2" : "transparent" })}>
      {body}
    </Pressable>
  );
  const label = (t: string) => (
    <Text style={{ fontFamily: FACE_SEMI, fontWeight: "normal", fontSize: 11, lineHeight: 14, letterSpacing: 0.6, color: META, textTransform: "uppercase", paddingHorizontal: 12, paddingBottom: 6 }}>{t}</Text>
  );
  const name = (t: string, sub?: string) => (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontFamily: FACE_SEMI, fontWeight: "normal", fontSize: 15, lineHeight: 20, color: INK }}>{t}</Text>
      {!!sub && <Text numberOfLines={1} style={{ fontFamily: FACE, fontWeight: "normal", fontSize: 12, lineHeight: 16, color: META }}>{sub}</Text>}
    </View>
  );
  // A person in the "@" list: their own tiny bot, decoration beside their name (which a screen reader reads).
  const botSize = K.num("ui.MentionField.botSize", 28);
  const face = (p: Row) => (p.bot
    ? <PersonBotView {...readPersonBot({ ...p.bot, size: botSize })} />
    : <View style={{ width: botSize, height: botSize, borderRadius: botSize / 2, backgroundColor: dotColor(p.name) }} />);
  let list: React.ReactNode = null;
  const m = st.menu;
  if (m?.kind === "people") {
    const shown = filterPeople(people, m.query);
    list = (
      <>
        {label(words.people)}
        {shown.length ? shown.map((p) => row(p.id, () => update(pickPerson(st, p)), (
          <>
            {face(p)}
            {name(p.name)}
          </>
        ))) : <Text style={{ fontFamily: FACE, fontSize: 14, lineHeight: 20, color: META, paddingHorizontal: 12, paddingVertical: 8 }}>{words.empty}</Text>}
      </>
    );
  } else if (m?.kind === "bots") {
    const shown = filterBots(bots, m.query);
    list = (
      <>
        {label(words.bots)}
        {shown.map((b) => row(b.slug, () => update(pickBot(st, b)), (
          <>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: b.color || INK, marginHorizontal: 11 }} />
            {name(b.name)}
          </>
        )))}
        {tools.length > 0 && <View style={{ height: 1, backgroundColor: LINE, marginHorizontal: 12, marginVertical: 6 }} />}
        {tools.map((t) => row(t.id, () => { update(pickTool(st)); void runAction(t.action, ctx); }, name(t.label)))}
      </>
    );
  } else if (m?.kind === "things") {
    const items = things.bot === m.bot ? things.items : null;
    list = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 6, paddingBottom: 6 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={K.txt("ui.MentionField.backToBots", "Back to bots")} onPress={() => update(escape(st))} hitSlop={8}
            style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: LINE, alignItems: "center", justifyContent: "center" }}>
            <Svg width={16} height={16} viewBox="0 0 24 24"><Path d="M15 5l-7 7 7 7" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: FACE_SEMI, fontWeight: "normal", fontSize: 15, lineHeight: 20, color: INK }}>{m.botName}</Text>
        </View>
        {items === null ? <ActivityIndicator style={{ paddingVertical: 12 }} color={IDLE} /> : items.length ? items.map((t) => row(t.id, () => update(pickThing(st, t)), (
          <>
            <View style={{ width: 4, height: 30, borderRadius: 2, backgroundColor: bots.find((b) => b.slug === m.bot)?.color || INK }} />
            {name(t.title, t.line)}
          </>
        ), 54)) : <Text style={{ fontFamily: FACE, fontSize: 14, lineHeight: 20, color: META, paddingHorizontal: 12, paddingVertical: 8 }}>{words.empty}</Text>}
      </>
    );
  }

  const chip = (key: string, text: string, off: () => void) => (
    <View key={key} style={{ height: 28, borderRadius: 14, backgroundColor: K.color("ui.MentionField.chip", "#f2f2f2"), flexDirection: "row", alignItems: "center", paddingLeft: 10, paddingRight: 4, gap: 2, maxWidth: 240 }}>
      <Text numberOfLines={1} style={{ fontFamily: FACE_SEMI, fontWeight: "normal", fontSize: 13, lineHeight: 16, color: INK, flexShrink: 1 }}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={K.txt("ui.MentionField.remove", "Remove") + " " + text} onPress={off} hitSlop={6}
        style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
        <Svg width={10} height={10} viewBox="0 0 10 10"><Path d="M2 2l6 6M8 2l-6 6" stroke={META} strokeWidth={1.5} strokeLinecap="round" /></Svg>
      </Pressable>
    </View>
  );
  const sendable = canSend(st);
  const maxLength = Number(props?.maxLength) > 0 ? Number(props.maxLength) : undefined;

  return (
    <View style={{ alignSelf: "stretch", paddingTop: list ? 10 : 0 }}>
      {list && (
        <ScrollView style={{ maxHeight: K.num("ui.MentionField.listMax", 240) }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          <View style={{ paddingHorizontal: 4, paddingBottom: 6 }}>{list}</View>
        </ScrollView>
      )}
      {list && <View style={{ height: 1, backgroundColor: LINE, marginHorizontal: 12 }} />}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, paddingLeft: 14, paddingRight: 8, paddingVertical: 8 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: 36 }}>
          {st.person && chip("person", st.person.name, () => update({ ...st, person: null }))}
          {st.thing && chip("thing", `${st.thing.title} · ${st.thing.botName}`, () => update({ ...st, thing: null }))}
          <TextInput
            ref={input}
            value={st.text}
            onChangeText={(t) => update(typed(st, t, Math.min(t.length, caret.current + (t.length - st.text.length))))}
            onSelectionChange={(e) => { caret.current = e.nativeEvent.selection.end; }}
            onKeyPress={(e) => {
              const k = e.nativeEvent.key;
              if (k === "Backspace" && !st.text) update(backspace(st));
              else if (k === "Escape") { if (st.menu) update(escape(st)); else input.current?.blur(); }
            }}
            onFocus={() => { focused.current = true; footer?.(true); }}
            onBlur={() => {
              focused.current = false;
              footer?.(false);
              // Left empty as the keyboard goes: the thought it is in closes (a moment later, unless it is back).
              setTimeout(() => { if (!focused.current && !canSend(stRef.current) && !stRef.current.person && !stRef.current.menu) thought?.close(); }, 150);
            }}
            onSubmitEditing={submit}
            submitBehavior="submit"
            returnKeyType="send"
            multiline
            autoFocus={props?.autoFocus === true}
            maxLength={maxLength}
            placeholder={st.person || st.thing ? "" : String(props?.placeholder ?? "")}
            placeholderTextColor={IDLE}
            style={[{ flexGrow: 1, minWidth: 80, maxHeight: 120, paddingVertical: 8, paddingHorizontal: 0, fontFamily: FACE, fontWeight: "normal", fontSize: 15, lineHeight: 20, color: INK }, WEB_FIELD]}
          />
        </View>
        {sendable && (
          <Pressable accessibilityRole="button" accessibilityLabel={K.txt("ui.MentionField.send", "Send")} onPress={submit}
            style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: INK, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <Svg width={18} height={18} viewBox="0 0 24 24"><Path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          </Pressable>
        )}
      </View>
    </View>
  );
};
