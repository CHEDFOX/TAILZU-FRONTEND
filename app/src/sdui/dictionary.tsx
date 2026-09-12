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
      fire("onError", String(props.errorMessage ?? "Couldn't save the dictionary"));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setSaving(false);
    }
  }, [rows, bindPath, store, fire, props.errorMessage]);

  /**
   * The look, as values. Every default below is what this component drew
   * before they existed, so nothing changes until a screen asks it to.
   *
   * They exist because a dictionary row is two fields and a save, and the
   * shape of those three is the whole of how the screen reads — pills on a
   * black ground on one screen, boxed inputs on a card on another. That is not
   * something a style on the node can reach: these are inputs INSIDE a
   * component, and a node style lands on the box around them.
   */
  const num = (v: unknown, d: number) => (v === undefined ? d : Number(v));
  const str = (v: unknown, d: string) => (v === undefined ? d : String(v));

  const cell = {
    backgroundColor: str(props.cellBackground, theme.color.inputBg),
    color: str(props.cellColor, theme.color.text),
    borderRadius: num(props.cellRadius, 10),
    borderWidth: num(props.cellBorderWidth, StyleSheet.hairlineWidth),
    borderColor: str(props.cellBorderColor, theme.color.border),
    paddingHorizontal: num(props.cellPaddingHorizontal, 12),
    paddingVertical: num(props.cellPaddingVertical, 10),
    fontSize: num(props.cellFontSize, 14),
    flex: 1,
  } as const;
  const placeholderColor = str(props.placeholderColor, theme.color.muted);
  /** Between the two fields of one pair, and between one pair and the next. */
  const cellGap = num(props.gap, 10);
  const rowGap = num(props.rowGap, 10);
  const removeColor = str(props.removeColor, theme.color.muted);
  /** Column headings. Two words over two fields that already say what they are. */
  const showLabels = props.showLabels !== false;

  const wordLabel = String(props.wordLabel ?? "Word");
  const replaceLabel = String(props.replaceLabel ?? "Replace With");
  const wordPlaceholder = String(props.wordPlaceholder ?? "omw");
  const replacePlaceholder = String(props.replacePlaceholder ?? "On My Way");
  const saveLabel = String(props.saveLabel ?? "Save");
  const savingLabel = String(props.savingLabel ?? "…");

  return (
    <View>
      {showLabels ? (
        <View style={s.headerRow}>
          <Text style={[s.col, { color: theme.color.label }]}>{wordLabel}</Text>
          <Text style={[s.col, { color: theme.color.label }]}>{replaceLabel}</Text>
        </View>
      ) : null}
      {rows.map((r, i) => (
        <View key={i} style={[s.row, { marginBottom: rowGap }]}>
          <TextInput
            style={cell} value={r.word} onChangeText={(t) => setRow(i, "word", t)}
            placeholder={wordPlaceholder} placeholderTextColor={placeholderColor}
            autoCapitalize="none" autoCorrect={false}
          />
          <View style={{ width: cellGap }} />
          <TextInput
            style={cell} value={r.replacement} onChangeText={(t) => setRow(i, "replacement", t)}
            placeholder={replacePlaceholder} placeholderTextColor={placeholderColor}
          />
          {full ? (
            <Pressable onPress={() => removeRow(i)} hitSlop={8} style={s.remove}>
              <Text style={{ color: removeColor, fontSize: 20 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      <Pressable
        onPress={save}
        disabled={saving}
        style={[
          s.save,
          {
            backgroundColor: str(props.saveBackground, theme.color.primary),
            borderRadius: num(props.saveRadius, 23),
            height: num(props.saveHeight, 46),
            // A save that spans the column reads as the end of the form; one
            // centred in it reads as a button that happens to be there. Which
            // is right depends on the screen, so the screen says.
            alignSelf: props.saveFullWidth ? "stretch" : "center",
            opacity: saving ? 0.5 : 1,
          },
        ]}
      >
        <Text
          style={[
            s.saveText,
            {
              color: str(props.saveColor, theme.color.primaryText ?? theme.color.bg),
              fontSize: num(props.saveFontSize, 15),
              letterSpacing: num(props.saveTracking, 0),
            },
          ]}
        >
          {saving ? savingLabel : saveLabel}
        </Text>
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
  row: { flexDirection: "row", alignItems: "center" },
  remove: { width: 26, alignItems: "center", justifyContent: "center" },
  save: { alignSelf: "center", minWidth: 110, height: 46, borderRadius: 23, paddingHorizontal: 32, alignItems: "center", justifyContent: "center", marginTop: 8 },
  saveText: { fontSize: 15, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
});
