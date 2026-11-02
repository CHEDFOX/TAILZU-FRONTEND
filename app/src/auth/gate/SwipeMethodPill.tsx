/** The swipe pill: drag the badge across (or tap the arrow) to send. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Keyboard, PanResponder, Platform, Pressable, Text, TextInput, TouchableOpacity, View } from "react-native";
import { BlurView } from "expo-blur";
import * as Localization from "expo-localization";
import { haptic } from "../../sdui/components/haptic";
import { pickCountry, type Country } from "../authConfig";
import { color, num, obj, str, txt } from "../../sdui/knobs";
import { PILL_H, MAX_DRAG, DRAG_THRESHOLD, emailRx, WHITE, ACCENT_DIM, at } from "./look";
import type { Field, PillLook } from "./types";
import { s } from "./styles";
import { Envelope, PhoneMark, Arrow, Chevron } from "./glyphs";
import { CountryPickerModal } from "./CountryPickerModal";

export function SwipeMethodPill({ field, onSubmit, hintDelay, look, style, resetAt }: {
  field: Field;
  onSubmit: (f: Field, value: string) => void;
  hintDelay: number;
  /**
   * Bump this to send the disc back to the left.
   *
   * NOT after a commit — see commit() below. The disc belongs at the right end
   * once it has been thrown there, and the only moment it should be at the
   * start again is when someone comes BACK to this screen to type a different
   * address. A number rather than a remount, because remounting would take the
   * typed value with it, and returning here to correct one character should not
   * clear the field.
   */
  resetAt?: number;
  /** Server overrides. Absent keys keep the shipped value. */
  look?: PillLook;
  style?: object;
}) {
  // One place the overrides land, so every use below reads the same resolved
  // value and a missing key can never become `undefined` in a style.
  const L: Required<PillLook> = {
    height: look?.height ?? PILL_H,
    radius: look?.radius ?? (look?.height ?? PILL_H) / 2,
    background: look?.background ?? color("auth.pill.bg", "rgba(255,255,255,0.06)"),
    borderColor: look?.borderColor ?? color("auth.pill.border", "rgba(255,255,255,0.10)"),
    textColor: look?.textColor ?? WHITE,
    placeholderColor: look?.placeholderColor ?? color("auth.pill.placeholder", "rgba(255,255,255,0.32)"),
    badgeBackground: look?.badgeBackground ?? color("auth.pill.badgeBg", "rgba(255,255,255,0.10)"),
    badgeBorderColor: look?.badgeBorderColor ?? color("auth.pill.badgeBorder", "rgba(255,255,255,0.18)"),
    targetBackground: look?.targetBackground ?? ACCENT_DIM,
    targetIconColor: look?.targetIconColor ?? color("auth.pill.targetIcon", "#000000"),
    fontSize: look?.fontSize ?? num("auth.pill.fontSize", 15),
    paddingLeft: look?.paddingLeft ?? PILL_H + 6,
  };
  const isPhone = field.type === "phone";
  const [value, setValue] = useState("");
  const region = Localization.getLocales?.()?.[0]?.regionCode || str("auth.defaultCountry", "US");
  const [country, setCountry] = useState<Country>(() => pickCountry(region));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phone: the number box does not open until a country is chosen. The flag
  // then takes the badge's place and the cursor lands in the box, so one
  // tap on the pill is the whole first step and the second is just typing.
  const [countryPicked, setCountryPicked] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const digits = value.replace(/\D/g, "");
  const valid = isPhone
    ? digits.length >= num("auth.phone.minDigits", 6) && digits.length <= num("auth.phone.maxDigits", 14)
    : emailRx().test(value.trim());
  const submitValue = isPhone ? `${country.dial}${digits}` : value.trim();

  const validRef = useRef(valid);
  const valRef = useRef(submitValue);
  const crossed = useRef(false);
  useEffect(() => { validRef.current = valid; }, [valid]);
  useEffect(() => { valRef.current = submitValue; }, [submitValue]);

  const envX = useRef(new Animated.Value(0)).current;
  const arrowAppear = useRef(new Animated.Value(0)).current;

  // THE ARROW APPEARS WHEN THERE IS SOMETHING WORTH SENDING.
  //
  // This effect was deleted by accident in the lift rewrite, and nothing
  // caught it: arrowAppear was still declared and still read, so it type-
  // checked perfectly and simply sat at zero forever. An animated value with
  // no animation is invisible in every sense — including to the compiler.
  useEffect(() => {
    Animated.timing(arrowAppear, {
      toValue: valid ? 1 : 0,
      duration: num("auth.anim.arrowFadeMs", 240),
      useNativeDriver: false,
    }).start();
  }, [valid, arrowAppear]);

  // ONLY THE PILL BEING TYPED IN MOVES.
  //
  // A KeyboardAvoidingView around the whole stack lifted everything — the
  // other method, the social row, the lot — so opening the keyboard rearranged
  // a screen the user was not interacting with. Each pill lifts itself instead,
  // and only while it holds the caret.
  //
  // Driven by BOTH focus and keyboard height, which is the part I got wrong
  // first time. Listening to show/hide alone breaks the moment there are two
  // fields: moving from one to the other while the keyboard is already up
  // fires NEITHER event on iOS, so the pill being left stayed lifted and the
  // pill being entered never rose — the written one ended up behind the
  // keyboard and the empty one hovered above it. Height is remembered, focus
  // is state, and the lift is recomputed whenever either changes.
  const lift = useRef(new Animated.Value(0)).current;
  const [focused, setFocused] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e: any) =>
      setKbHeight(e?.endCoordinates?.height ?? 0));
    const onHide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  useEffect(() => {
    // Clear the keyboard, plus a little air. The screen's own bottom padding
    // already sits below the pill, so the full keyboard height overshoots.
    const to = focused && kbHeight > 0 ? -(kbHeight - num("auth.pill.keyboardOverlap", 34)) : 0;
    const spring = obj("auth.anim.liftSpring", { damping: 20, stiffness: 190, mass: 0.7 });
    Animated.spring(lift, {
      toValue: to,
      damping: spring.damping, stiffness: spring.stiffness, mass: spring.mass,
      useNativeDriver: true,
    }).start();
  }, [focused, kbHeight, lift]);

  // THE SWIPE HINT. Deleted by accident when the lift was rewritten, and it
  // is the only thing that tells anyone the badge is draggable — without it
  // the gesture exists and nobody finds it. One nudge out and back, once.
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.sequence([
        Animated.spring(envX, { toValue: num("auth.anim.hintNudge", 22), friction: 5, tension: 90, useNativeDriver: false }),
        Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }),
      ]).start();
    }, hintDelay);
    return () => clearTimeout(t);
  }, [envX, hintDelay]);

  /**
   * Throw the disc to the far end, and LEAVE IT THERE.
   *
   * It used to snap back to zero the instant the animation finished. That was
   * invisible while a send animation covered the screen for a second and a
   * half; now that the code screen opens in the frame you tap, the snap happens
   * in full view — the disc arrives at the right and is instantly at the left
   * again, which reads as the gesture being refused rather than accepted.
   *
   * A control that has done its job should look like it has done its job. The
   * disc goes back to the start when the screen is returned to, and not before.
   */
  const commit = useCallback(() => {
    Animated.timing(envX, { toValue: MAX_DRAG, duration: num("auth.anim.commitMs", 230), easing: Easing.out(Easing.cubic), useNativeDriver: false })
      .start(() => onSubmit(field, valRef.current));
  }, [envX, field, onSubmit]);

  // Back on this screen: put the disc at the start so the gesture reads as
  // available again. Skipped on first mount — it is already there.
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    envX.setValue(0);
    crossed.current = false;
    parked.current = false;
  }, [resetAt, envX]);

  /** Parked at the far end on an invalid value, waiting for an edit. */
  const parked = useRef(false);

  // Editing is the answer to a pill parked on a value it could not send, so
  // the disc comes back and the gesture is available again. Only then: a disc
  // that returns for any other reason is the gesture being withdrawn.
  useEffect(() => {
    if (!parked.current) return;
    parked.current = false;
    crossed.current = false;
    Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start();
  }, [value, envX]);

  const pan = useRef(
    PanResponder.create({
      // CLAIM ON START, not just on move. A dismiss layer has to be an
      // ANCESTOR to catch the gaps — a sibling underneath never sees a touch
      // that landed inside a full-width row, which is most of this screen. But
      // an ancestor Touchable claims on touch start, and a pan that only
      // claims on MOVE has already lost by then. Claiming here settles it:
      // children are offered a touch before parents, so the badge takes its
      // own and every other tap falls through to the dismiss.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => { haptic(str("app.haptics.auth.pillGrab", "light")); crossed.current = false; },
      onPanResponderMove: (_, g) => {
        const x = Math.max(0, Math.min(MAX_DRAG, g.dx));
        envX.setValue(x);
        if (!crossed.current && x >= DRAG_THRESHOLD) { crossed.current = true; haptic(str("app.haptics.auth.pillCross", "selection")); }
        else if (crossed.current && x < DRAG_THRESHOLD) crossed.current = false;
      },
      onPanResponderRelease: (_, g) => {
        const x = Math.max(0, Math.min(MAX_DRAG, g.dx));
        // CROSSED IS CROSSED. Once the disc is past the threshold it finishes
        // its travel and stays at the far end, whatever happens next.
        //
        // It used to spring home when the field was not yet valid, which is
        // the gesture being taken back in front of the person who made it —
        // and the only thing distinguishing that from a refused drag was a
        // haptic they may not have felt. The disc now lands where it was sent
        // and the pill says what is wrong, which is the difference between
        // "that did not work" and "that did not happen".
        //
        // It comes back when the input changes, because editing is what makes
        // the gesture worth offering again.
        if (x >= DRAG_THRESHOLD) {
          if (validRef.current) { commit(); return; }
          haptic(str("app.haptics.auth.pillRefused", "warning"));
          parked.current = true;
          Animated.timing(envX, {
            toValue: MAX_DRAG, duration: num("auth.anim.parkMs", 180), easing: Easing.out(Easing.cubic), useNativeDriver: false,
          }).start();
          return;
        }
        Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => Animated.spring(envX, { toValue: 0, friction: 6, tension: 80, useNativeDriver: false }).start(),
    }),
  ).current;

  const overlapFade = envX.interpolate({ inputRange: [MAX_DRAG * 0.55, MAX_DRAG], outputRange: [1, 0], extrapolate: "clamp" });
  const arrowOpacity = Animated.multiply(arrowAppear, overlapFade);
  const inputOpacity = envX.interpolate({ inputRange: [0, MAX_DRAG], outputRange: [1, 0.12], extrapolate: "clamp" });

  return (
    <Animated.View style={[s.pillWrap, { height: L.height, borderRadius: L.radius }, style, { transform: [{ translateY: lift }] }]}>
      {/* iOS: frosted-glass pill. Android: expo-blur doesn't blur (and the 6%
          fill is invisible on OLED dark), so the oval "disappeared" — use a
          solid translucent fill there so the pill always reads as a pill. */}
      {Platform.OS === "ios" ? (
        <BlurView intensity={24} tint="light" style={s.pill} />
      ) : (
        <View style={[s.pill, s.pillAndroid, { backgroundColor: L.background, borderRadius: L.radius }]} />
      )}
      <View style={[s.pillBorder, { borderColor: L.borderColor, borderRadius: L.radius }]} pointerEvents="none" />

      <Animated.View style={[s.contentRow, { opacity: inputOpacity }]} pointerEvents="box-none">
        {isPhone && !countryPicked && (
          <TouchableOpacity
            style={s.pickRow}
            activeOpacity={0.7}
            onPress={() => { Keyboard.dismiss(); haptic(str("app.haptics.auth.countryOpen", "selection")); setPickerOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel={txt("auth.a11y.chooseCountry", "Choose your country")}
          >
            <Text style={[s.pickText, at("authPrompt", null)]}>{txt("auth.phone.prompt", "Phone")}</Text>
            <Chevron />
          </TouchableOpacity>
        )}
        {(!isPhone || countryPicked) && <TextInput underlineColorAndroid="transparent"
          ref={inputRef}
          style={[s.input, at("authField", null), { color: L.textColor, fontSize: L.fontSize }]}
          placeholderTextColor={L.placeholderColor}
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={isPhone ? txt("auth.phone.placeholder", "Number") : txt("auth.email.placeholder", "Email")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={isPhone ? "phone-pad" : "email-address"}
          textContentType={isPhone ? "telephoneNumber" : "emailAddress"}
          returnKeyType="go"
          onSubmitEditing={() => validRef.current && commit()}
        />}
      </Animated.View>

      {/* badge — swipe me. Envelope for email; the phone mark until a country
          is chosen, then that country's flag, so the pill itself says which
          number it is asking for. */}
      <Animated.View style={[s.envWrap, { transform: [{ translateX: envX }] }]} {...pan.panHandlers}>
        <View style={[s.envCircle, { backgroundColor: L.badgeBackground, borderColor: L.badgeBorderColor }]}>
          {!isPhone ? <Envelope /> : countryPicked ? (
            // The flag lives HERE and only here — it was also being drawn
            // where the dial code used to sit, which put two of them on one
            // pill. Tapping it reopens the picker, so removing the duplicate
            // costs nothing: the swipe still submits, because PanResponder
            // only claims a finger that has moved, and a tap has not.
            <Pressable
              onPress={() => { Keyboard.dismiss(); haptic(str("app.haptics.auth.countryOpen", "selection")); setPickerOpen(true); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={txt("auth.a11y.changeCountry", "Country {name}, change", { name: country.name })}
            >
              <Text style={s.badgeFlag}>{country.flag}</Text>
            </Pressable>
          ) : <PhoneMark />}
        </View>
      </Animated.View>

      {/* The target. Tapping it runs the same commit the swipe does,
          so the badge travels across to meet it either way — the tap is not a
          shortcut past the gesture, it IS the gesture, played for you. */}
      <Animated.View style={[s.arrowWrap, { opacity: arrowOpacity }]} pointerEvents={valid ? "auto" : "none"}>
        <TouchableOpacity style={[s.arrowCircle, { backgroundColor: L.targetBackground }]} activeOpacity={0.85} onPress={() => validRef.current && commit()}>
          <Arrow c={L.targetIconColor} />
        </TouchableOpacity>
      </Animated.View>

      {isPhone && (
        <CountryPickerModal
          visible={pickerOpen}
          current={country}
          onClose={() => setPickerOpen(false)}
          onSelect={(c) => {
            setCountry(c);
            setCountryPicked(true);
            haptic(str("app.haptics.auth.countryPick", "selection"));
            // The modal is still closing; focus once it has let go of the
            // screen, or the keyboard fights the dismissal.
            setTimeout(() => inputRef.current?.focus(), num("auth.anim.pickerFocusMs", 260));
          }}
        />
      )}
    </Animated.View>
  );
}
