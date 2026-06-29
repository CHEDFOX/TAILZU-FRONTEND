/**
 * Dictionary (text-expansion) + frequent-word components for Home.
 *
 * DictionaryEditor — two columns (Word → Replace With). The user's pairs are
 * saved to the profile AND pushed to the keyboard (App Group) so typing the word
 * auto-expands it anywhere. `full` mode (the Dictionary page) shows every row
 * with delete + an always-trailing blank to add; compact mode (Home) shows a few
 * rows. Save persists + syncs to the keyboard.
 *
 * WordChips — renders the backend-computed "words you use often" as tappable
 * chips (bound array or props.words).
 */
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CompProps } from "./components";
import { useTheme } from "./components";
import { callEndpoint } from "./client";
import { setKeyboardDictionary } from "../../modules/tulmi-bridge";

interface Entry { word: string; replacement: string }

function toEntries(v: any): Entry[] {
  if (!Array.isArray(v)) return [];
  return v.map((e) => ({
    word: String(e?.word ?? e?.trigger ?? ""),
    replacement: String(e?.replacement ?? e?.expansion ?? ""),
  }));
}

export const DictionaryEditor = ({ node, props, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  const full = !!props.full;
  const minRows = Number(props.rows) || 2;

  const initial = useMemo(() => toEntries(bindPath ? store.get(bindPath) : props.entries), []); // once
  const [rows, setRows] = useState<Entry[]>(() => {
    const r = [...initial];
    if (full) r.push({ word: "", replacement: "" });
    else while (r.length < minRows) r.push({ word: "", replacement: "" });
    return r;
  });
  const [saving, setSaving] = useState(false);

  const setRow = useCallback((i: number, k: keyof Entry, val: string) => {
    setRows((rs) => {
      const c = rs.map((r, idx) => (idx === i ? { ...r, [k]: val } : r));
      // In full mode keep a blank row at the end to add the next pair.
      if (full && i === c.length - 1 && (c[i].word || c[i].replacement)) c.push({ word: "", replacement: "" });
      return c;
    });
  }, [full]);

  const removeRow = useCallback((i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i)), []);

  const save = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSaving(true);
    const clean = rows
      .map((r) => ({ word: r.word.trim(), replacement: r.replacement.trim() }))
      .filter((r) => r.word && r.replacement);
    try {
      await callEndpoint("PUT", "/v1/profile", { dictionary: clean });
      setKeyboardDictionary(clean); // push to the keyboard (App Group)
      if (bindPath) store.set(bindPath, clean);
      fire("onChange", clean);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e: any) {
      fire("onError", "Couldn't save the dictionary");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setSaving(false);
    }
  }, [rows, bindPath, store, fire]);

  const cell = {
    backgroundColor: theme.color.inputBg, color: theme.color.text, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, flex: 1,
  } as const;

  return (
    <View>
      <View style={s.headerRow}>
        <Text style={[s.col, { color: theme.color.label }]}>Word</Text>
        <Text style={[s.col, { color: theme.color.label }]}>Replace With</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row}>
          <TextInput
            style={cell} value={r.word} onChangeText={(t) => setRow(i, "word", t)}
            placeholder="omw" placeholderTextColor={theme.color.muted}
            autoCapitalize="none" autoCorrect={false}
          />
          <View style={{ width: 10 }} />
          <TextInput
            style={cell} value={r.replacement} onChangeText={(t) => setRow(i, "replacement", t)}
            placeholder="On My Way" placeholderTextColor={theme.color.muted}
          />
          {full ? (
            <Pressable onPress={() => removeRow(i)} hitSlop={8} style={s.remove}>
              <Text style={{ color: theme.color.muted, fontSize: 20 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Pressable onPress={save} disabled={saving} style={[s.save, { opacity: saving ? 0.5 : 1 }]}>
        <Text style={s.saveText}>{saving ? "…" : "Save"}</Text>
      </Pressable>
    </View>
  );
};

export const WordChips = ({ node, props, store, fire }: CompProps) => {
  const theme = useTheme();
  const bindPath = node.bind?.value;
  const raw = bindPath ? store.get(bindPath) : props.words;
  const words: string[] = Array.isArray(raw) ? raw.map(String) : [];
  if (!words.length) {
    return <Text style={{ color: theme.color.muted, fontSize: 13 }}>{props.empty ?? "We'll learn your words as you write."}</Text>;
  }
  return (
    <View style={s.chips}>
      {words.map((w, i) => (
        <Pressable
          key={`${w}-${i}`}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); fire("onPress", w); }}
          style={[s.chip, { borderColor: theme.color.border }]}
        >
          <Text style={{ color: theme.color.body ?? theme.color.text, fontSize: 14 }}>{w}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const s = StyleSheet.create({
  headerRow: { flexDirection: "row", marginBottom: 8 },
  col: { flex: 1, fontSize: 12, fontWeight: "600", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  remove: { width: 26, alignItems: "center", justifyContent: "center" },
  save: { alignSelf: "center", minWidth: 110, height: 46, borderRadius: 23, paddingHorizontal: 32, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 8 },
  saveText: { color: "#000", fontSize: 15, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
});
