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
import * as K from "./knobs";

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
      fire("onError", String(props.errorMessage ?? K.txt("ui.DictionaryEditor.errorMessage", "Couldn't save the dictionary")));
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
   *
   * Prop first, then the ui.DictionaryEditor.* knob (every editor at once),
   * then the literal it always was.
   */
  const pn = (v: unknown, d: number) => (v === undefined ? d : Number(v));
  const ps = (v: unknown, d: string) => (v === undefined ? d : String(v));

  const cell = {
    backgroundColor: ps(props.cellBackground, theme.color.inputBg),
    color: ps(props.cellColor, theme.color.text),
    borderRadius: pn(props.cellRadius, K.num("ui.DictionaryEditor.cellRadius", 10)),
    // -1 (the default) means the device's hairline, which is not a number
    // anyone can write down: it is one physical pixel, whatever that is here.
    borderWidth: pn(props.cellBorderWidth, (() => {
      const w = K.num("ui.DictionaryEditor.cellBorderWidth", -1);
      return w < 0 ? StyleSheet.hairlineWidth : w;
    })()),
    borderColor: ps(props.cellBorderColor, theme.color.border),
    paddingHorizontal: pn(props.cellPaddingHorizontal, K.num("ui.DictionaryEditor.cellPaddingHorizontal", 12)),
    paddingVertical: pn(props.cellPaddingVertical, K.num("ui.DictionaryEditor.cellPaddingVertical", 10)),
    fontSize: pn(props.cellFontSize, K.num("ui.DictionaryEditor.cellFontSize", 14)),
    flex: 1,
  } as const;
  const placeholderColor = ps(props.placeholderColor, theme.color.muted);
  /** Between the two fields of one pair, and between one pair and the next. */
  const cellGap = pn(props.gap, K.num("ui.DictionaryEditor.gap", 10));
  const rowGap = pn(props.rowGap, K.num("ui.DictionaryEditor.rowGap", 10));
  const removeColor = ps(props.removeColor, theme.color.muted);
  const removeGlyph = ps(props.removeGlyph, K.txt("ui.DictionaryEditor.removeGlyph", "×"));
  const removeSize = pn(props.removeSize, K.num("ui.DictionaryEditor.removeSize", 20));
  const removeWidth = pn(props.removeWidth, K.num("ui.DictionaryEditor.removeWidth", 26));
  const removeHitSlop = pn(props.removeHitSlop, K.num("ui.DictionaryEditor.removeHitSlop", 8));
  /** Column headings. Two words over two fields that already say what they are. */
  const showLabels = props.showLabels !== false;
  const headerMarginBottom = pn(props.headerMarginBottom, K.num("ui.DictionaryEditor.headerMarginBottom", 8));
  const headerSize = pn(props.headerSize, K.num("ui.DictionaryEditor.headerSize", 12));
  const headerWeight = ps(props.headerWeight, K.str("ui.DictionaryEditor.headerWeight", "600")) as "600";
  const headerTracking = pn(props.headerTracking, K.num("ui.DictionaryEditor.headerTracking", 0.4));
  const headerColor = ps(props.headerColor, theme.color.label);

  const wordLabel = String(props.wordLabel ?? K.txt("ui.DictionaryEditor.wordLabel", "Word"));
  const replaceLabel = String(props.replaceLabel ?? K.txt("ui.DictionaryEditor.replaceLabel", "Replace With"));
  const wordPlaceholder = String(props.wordPlaceholder ?? K.txt("ui.DictionaryEditor.wordPlaceholder", "omw"));
  const replacePlaceholder = String(props.replacePlaceholder ?? K.txt("ui.DictionaryEditor.replacePlaceholder", "On My Way"));
  const saveLabel = String(props.saveLabel ?? K.txt("ui.DictionaryEditor.saveLabel", "Save"));
  const savingLabel = String(props.savingLabel ?? K.txt("ui.DictionaryEditor.savingLabel", "…"));

  return (
    <View>
      {showLabels ? (
        <View style={[s.headerRow, { marginBottom: headerMarginBottom }]}>
          <Text style={[s.col, { color: headerColor, fontSize: headerSize, fontWeight: headerWeight, letterSpacing: headerTracking }]}>{wordLabel}</Text>
          <Text style={[s.col, { color: headerColor, fontSize: headerSize, fontWeight: headerWeight, letterSpacing: headerTracking }]}>{replaceLabel}</Text>
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
            <Pressable onPress={() => removeRow(i)} hitSlop={removeHitSlop} style={[s.remove, { width: removeWidth }]}>
              <Text style={{ color: removeColor, fontSize: removeSize }}>{removeGlyph}</Text>
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
            backgroundColor: ps(props.saveBackground, theme.color.primary),
            borderRadius: pn(props.saveRadius, K.num("ui.DictionaryEditor.saveRadius", 23)),
            height: pn(props.saveHeight, K.num("ui.DictionaryEditor.saveHeight", 46)),
            minWidth: pn(props.saveMinWidth, K.num("ui.DictionaryEditor.saveMinWidth", 110)),
            paddingHorizontal: pn(props.savePaddingHorizontal, K.num("ui.DictionaryEditor.savePaddingHorizontal", 32)),
            marginTop: pn(props.saveMarginTop, K.num("ui.DictionaryEditor.saveMarginTop", 8)),
            // A save that spans the column reads as the end of the form; one
            // centred in it reads as a button that happens to be there. Which
            // is right depends on the screen, so the screen says.
            alignSelf: props.saveFullWidth ? "stretch" : "center",
            opacity: saving ? pn(props.savingOpacity, K.num("ui.DictionaryEditor.savingOpacity", 0.5)) : 1,
          },
        ]}
      >
        <Text
          style={[
            s.saveText,
            {
              color: ps(props.saveColor, theme.color.primaryText ?? theme.color.bg),
              fontSize: pn(props.saveFontSize, K.num("ui.DictionaryEditor.saveFontSize", 15)),
              fontWeight: ps(props.saveWeight, K.str("ui.DictionaryEditor.saveWeight", "700")) as "700",
              letterSpacing: pn(props.saveTracking, K.num("ui.DictionaryEditor.saveTracking", 0)),
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
    return (
      <Text style={{ color: props.emptyColor ?? theme.color.muted, fontSize: Number(props.emptySize ?? K.num("ui.WordChips.emptySize", 13)) }}>
        {props.empty ?? K.txt("ui.WordChips.empty", "We'll learn your words as you write.")}
      </Text>
    );
  }
  const chip = {
    paddingHorizontal: Number(props.chipPaddingHorizontal ?? K.num("ui.WordChips.chipPaddingHorizontal", 14)),
    paddingVertical: Number(props.chipPaddingVertical ?? K.num("ui.WordChips.chipPaddingVertical", 8)),
    borderRadius: Number(props.chipRadius ?? K.num("ui.WordChips.chipRadius", 999)),
    borderWidth: Number(props.chipBorderWidth ?? K.num("ui.WordChips.chipBorderWidth", 1)),
    borderColor: String(props.chipBorderColor ?? theme.color.border),
  };
  return (
    <View style={[s.chips, { gap: Number(props.gap ?? K.num("ui.WordChips.gap", 9)) }]}>
      {words.map((w, i) => (
        <Pressable
          key={`${w}-${i}`}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); fire("onPress", w); }}
          style={chip}
        >
          <Text style={{ color: props.chipTextColor ?? theme.color.body ?? theme.color.text, fontSize: Number(props.chipFontSize ?? K.num("ui.WordChips.chipFontSize", 14)) }}>{w}</Text>
        </Pressable>
      ))}
    </View>
  );
};

// Layout only. Every size, colour and weight is applied per render above,
// from props and knobs, so none of them is fixed at module load.
const s = StyleSheet.create({
  headerRow: { flexDirection: "row" },
  col: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  remove: { alignItems: "center", justifyContent: "center" },
  save: { alignSelf: "center", alignItems: "center", justifyContent: "center" },
  saveText: {},
  chips: { flexDirection: "row", flexWrap: "wrap" },
});
