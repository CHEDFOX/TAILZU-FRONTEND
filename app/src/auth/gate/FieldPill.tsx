import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import * as Localization from "expo-localization";
import { haptic } from "../../sdui/components/haptic";
import { countries, pickCountry, type Country } from "../authConfig";
import { num, str, txt } from "../../sdui/knobs";
import { emailRx } from "./look";
import type { Field, PillLook, FieldLook } from "./types";
import { Chevron } from "./glyphs";
import { CountryPickerModal } from "./CountryPickerModal";
import { typedMemory } from "./typedMemory";

/**
 * The onboarding sign-in's way of asking: a plain box, and under it a full
 * width button that says what it will do ("Continue with email"). Nothing to
 * swipe and nothing to find: the button is enabled when the box holds
 * something worth sending, and it goes through the same path the swipe does
 * (a haptic, then onSubmit), so the flow behind it cannot tell the difference.
 *
 * A phone number opens at once with a country chip on its left, which is
 * where this person probably is: the device's own region if it is on the list,
 * else the one the server named. Tapping the chip opens the same picker the
 * swipe pill has.
 */
export function FieldPill({ field, onSubmit, look, style }: {
  field: Field;
  onSubmit: (f: Field, value: string) => void;
  look: PillLook & FieldLook;
  style?: object;
}) {
  const isPhone = field.type === "phone";
  const L = {
    height: look.height ?? 48,
    radius: look.radius ?? 16,
    background: look.background ?? "#FFFFFF",
    borderColor: look.borderColor ?? "#1C1A17",
    textColor: look.textColor ?? "#1C1A17",
    placeholderColor: look.placeholderColor ?? "rgba(28,26,23,0.56)",
    fontSize: look.fontSize ?? 17,
    buttonBackground: look.buttonBackground ?? "#1C1A17",
    buttonTextColor: look.buttonTextColor ?? "#FCFBF8",
    buttonHeight: look.buttonHeight ?? look.height ?? 48,
    buttonRadius: look.buttonRadius ?? look.radius ?? 16,
    countryBackground: look.countryBackground ?? "#FCFBF8",
    countryBorderColor: look.countryBorderColor ?? "rgba(28,26,23,0.13)",
  };
  const [value, setValueState] = useState(() => typedMemory.get(field.type) ?? "");
  const setValue = (v: string) => { typedMemory.set(field.type, v); setValueState(v); };
  const [country, setCountry] = useState<Country>(() => {
    const region = (Localization.getLocales?.()?.[0]?.regionCode || "").toUpperCase();
    const saved = typedMemory.get("phone:country");
    const list = countries();
    return list.find((c) => c.iso === saved) ?? list.find((c) => c.iso === region)
      ?? pickCountry(look.presetCountry ?? region);
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const digits = value.replace(/\D/g, "");
  const valid = isPhone
    ? digits.length >= num("auth.phone.minDigits", 6) && digits.length <= num("auth.phone.maxDigits", 14)
    : emailRx().test(value.trim());
  const submitValue = isPhone ? `${country.dial}${digits}` : value.trim();
  const valRef = useRef(submitValue);
  const validRef = useRef(valid);
  useEffect(() => { valRef.current = submitValue; validRef.current = valid; }, [submitValue, valid]);

  const commit = () => {
    if (!validRef.current) return;
    haptic(str("app.haptics.auth.submit", "light"));
    onSubmit(field, valRef.current);
  };

  const openPicker = () => { Keyboard.dismiss(); haptic(str("app.haptics.auth.countryOpen", "selection")); setPickerOpen(true); };

  return (
    <View style={[{ gap: 8 }, style]}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {isPhone && (
          <Pressable
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityLabel={txt("auth.a11y.changeCountry", "Country {name}, change", { name: country.name })}
            style={{
              height: L.height, flexDirection: "row", alignItems: "center", gap: 3,
              paddingLeft: 13, paddingRight: 8, borderRadius: L.radius,
              borderWidth: 1.5, borderColor: L.countryBorderColor, backgroundColor: L.countryBackground,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700", color: L.textColor }}>{country.iso} {country.dial}</Text>
            <Chevron c={L.textColor} />
          </Pressable>
        )}
        <TextInput
          ref={inputRef}
          underlineColorAndroid="transparent"
          style={{
            flex: 1, minWidth: 0, height: L.height, borderRadius: L.radius,
            borderWidth: 1.5, borderColor: L.borderColor, backgroundColor: L.background,
            paddingHorizontal: 14, paddingVertical: 0,
            fontSize: L.fontSize, fontWeight: "600", letterSpacing: L.fontSize * 0.02, color: L.textColor,
          }}
          placeholder={look.placeholder ?? (isPhone ? txt("auth.phone.placeholder", "Number") : txt("auth.email.placeholder", "Email"))}
          placeholderTextColor={L.placeholderColor}
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={isPhone ? "phone-pad" : "email-address"}
          textContentType={isPhone ? "telephoneNumber" : "emailAddress"}
          autoComplete={isPhone ? "tel-national" : "email"}
          returnKeyType="go"
          onSubmitEditing={commit}
        />
      </View>
      <Pressable
        onPress={commit}
        disabled={!valid}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid }}
        style={({ pressed }) => ({
          height: L.buttonHeight, borderRadius: L.buttonRadius, backgroundColor: L.buttonBackground,
          alignItems: "center", justifyContent: "center",
          opacity: !valid ? 0.3 : pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ fontSize: 16, fontWeight: "600", color: L.buttonTextColor }}>
          {look.submitLabel ?? txt("auth.submit", "Continue")}
        </Text>
      </Pressable>
      {isPhone && (
        <CountryPickerModal
          visible={pickerOpen}
          current={country}
          onClose={() => setPickerOpen(false)}
          onSelect={(c) => {
            setCountry(c);
            typedMemory.set("phone:country", c.iso);
            haptic(str("app.haptics.auth.countryPick", "selection"));
            setTimeout(() => inputRef.current?.focus(), num("auth.anim.pickerFocusMs", 260));
          }}
        />
      )}
    </View>
  );
}
