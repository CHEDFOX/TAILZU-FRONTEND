/** The country sheet (phone sign-in only). */
import { useState } from "react";
import { FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { countries, type Country } from "../authConfig";
import { color, txt } from "../../sdui/knobs";
import { WHITE, at } from "./look";
import { s } from "./styles";

export function CountryPickerModal({
  visible, current, onClose, onSelect,
}: { visible: boolean; current: Country; onClose: () => void; onSelect: (c: Country) => void }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const all = countries();
  const data = term
    ? all.filter((c) => String(c.name ?? "").toLowerCase().includes(term) || c.dial.includes(term))
    : all;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <TextInput underlineColorAndroid="transparent"
            style={[s.modalSearch, at("authSearch", null)]}
            value={q}
            onChangeText={setQ}
            placeholder={txt("auth.country.search", "Search")}
            placeholderTextColor={color("auth.country.searchPlaceholder", "rgba(255,255,255,0.3)")}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <FlatList
            data={data}
            keyExtractor={(c) => c.iso}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            renderItem={({ item }) => {
              const sel = current.iso === item.iso;
              return (
                <TouchableOpacity style={s.cRow} activeOpacity={0.6} onPress={() => { onSelect(item); onClose(); }}>
                  <Text style={s.cFlag}>{item.flag}</Text>
                  <Text style={[s.cName, at("authPickName", null), sel ? { color: WHITE, fontWeight: "600" } : null]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[s.cDial, at("authPickDial", null)]}>{item.dial}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
