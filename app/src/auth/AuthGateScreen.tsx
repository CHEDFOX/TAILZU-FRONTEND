/**
 * AuthGate — Plutto-style sign-in. Email → 6-digit code → verify, plus native
 * Apple + Google. Editorial dark theme: black ground, serif, hairline pills,
 * a quiet bronze CTA. Social buttons only render when available/configured, so
 * email login works even before Apple/Google are set up.
 */
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { supabaseAuth } from "./supabaseClient";
import { GOOGLE_OAUTH, isGoogleConfigured } from "./authConfig";

const SERIF = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });
const C = {
  bg: "#000000",
  text: "rgba(255,255,255,0.96)",
  body: "rgba(255,255,255,0.60)",
  faint: "rgba(255,255,255,0.40)",
  hair: "rgba(255,255,255,0.14)",
  cta: "#8B7355", // quiet bronze
  accent: "#D4AF37", // gold — used only as a tiny touch
  error: "#FF453A",
};
const CODE_LEN = 6;

if (isGoogleConfigured()) {
  GoogleSignin.configure({
    webClientId: GOOGLE_OAUTH.webClientId,
    iosClientId: GOOGLE_OAUTH.iosClientId,
  });
}

export default function AuthGateScreen({ onAuthed }: { onAuthed: () => void }) {
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<TextInput>(null);

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  async function sendCode() {
    if (!emailOk || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseAuth.sendEmailCode(email.trim());
    setBusy(false);
    if (error) return setError(error.message);
    setPhase("code");
    setTimeout(() => codeRef.current?.focus(), 250);
  }

  async function verify(token: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabaseAuth.verifyEmailCode(email.trim(), token);
    setBusy(false);
    if (error) {
      setError(error.message);
      setCode("");
      return;
    }
    Keyboard.dismiss();
    onAuthed();
  }

  function onCodeChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, CODE_LEN);
    setCode(digits);
    if (digits.length === CODE_LEN) verify(digits); // auto-verify on the last digit
  }

  async function onApple() {
    try {
      setError(null);
      const rawNonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!cred.identityToken) throw new Error("No Apple identity token");
      const { error } = await supabaseAuth.signInWithApple(cred.identityToken, rawNonce);
      if (error) throw error;
      onAuthed();
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") setError(e?.message ?? "Apple sign-in failed");
    }
  }

  async function onGoogle() {
    try {
      setError(null);
      await GoogleSignin.hasPlayServices();
      const res: any = await GoogleSignin.signIn();
      const idToken = res?.data?.idToken ?? res?.idToken;
      if (!idToken) throw new Error("No Google id token");
      const { error } = await supabaseAuth.signInWithGoogle(idToken);
      if (error) throw error;
      onAuthed();
    } catch (e: any) {
      if (e?.code !== "SIGN_IN_CANCELLED") setError(e?.message ?? "Google sign-in failed");
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={s.inner}>
        <Text style={s.overline}>VOICE · REFINE · REPLY</Text>
        <Text style={s.brand}>Tailzu</Text>

        {phase === "email" ? (
          <>
            <Text style={s.sub}>Enter your email and we'll send you a code.</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@email.com"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={sendCode}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Pressable
              style={[s.cta, (!emailOk || busy) && s.ctaOff]}
              onPress={sendCode}
              disabled={!emailOk || busy}
            >
              {busy ? <ActivityIndicator color="#1a1407" /> : <Text style={s.ctaText}>Continue</Text>}
            </Pressable>

            <View style={s.divider}>
              <View style={s.line} />
              <Text style={s.or}>or</Text>
              <View style={s.line} />
            </View>

            {Platform.OS === "ios" ? (
              <Pressable style={s.social} onPress={onApple}>
                <Text style={s.socialText}> Continue with Apple</Text>
              </Pressable>
            ) : null}
            {isGoogleConfigured() ? (
              <Pressable style={s.social} onPress={onGoogle}>
                <Text style={s.socialText}>Continue with Google</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={s.sub}>
              Enter the {CODE_LEN}-digit code we sent to{"\n"}
              <Text style={{ color: C.text }}>{email.trim()}</Text>
            </Text>
            <Pressable onPress={() => codeRef.current?.focus()}>
              <View style={s.codeRow}>
                {Array.from({ length: CODE_LEN }).map((_, i) => (
                  <View key={i} style={[s.codeBox, code.length === i && s.codeBoxActive]}>
                    <Text style={s.codeDigit}>{code[i] ?? ""}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
            <TextInput
              ref={codeRef}
              style={s.hiddenInput}
              value={code}
              onChangeText={onCodeChange}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={CODE_LEN}
              autoFocus
            />
            {busy ? <ActivityIndicator color={C.accent} style={{ marginTop: 16 }} /> : null}
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Pressable onPress={sendCode} disabled={busy} hitSlop={12} style={{ marginTop: 20 }}>
              <Text style={s.resend}>Resend code</Text>
            </Pressable>
            <Pressable onPress={() => { setPhase("email"); setCode(""); setError(null); }} hitSlop={12} style={{ marginTop: 12 }}>
              <Text style={s.resend}>Use a different email</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  inner: { flex: 1, paddingHorizontal: 32, justifyContent: "center" },
  overline: { color: C.faint, fontSize: 11, fontWeight: "500", letterSpacing: 2, textAlign: "center" },
  brand: { fontFamily: SERIF, color: C.text, fontSize: 44, fontWeight: "300", textAlign: "center", marginTop: 8, marginBottom: 28 },
  sub: { color: C.body, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 24 },
  input: {
    height: 56, borderRadius: 28, borderWidth: 0.5, borderColor: C.hair,
    paddingHorizontal: 22, color: C.text, fontSize: 16, backgroundColor: "rgba(255,255,255,0.03)",
  },
  cta: { height: 56, borderRadius: 28, backgroundColor: C.cta, alignItems: "center", justifyContent: "center", marginTop: 16 },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: "#1a1407", fontSize: 16, fontWeight: "700", letterSpacing: 0.4 },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 24 },
  line: { flex: 1, height: 0.5, backgroundColor: C.hair },
  or: { color: C.faint, fontSize: 13, marginHorizontal: 14 },
  social: { height: 54, borderRadius: 27, borderWidth: 0.5, borderColor: C.hair, alignItems: "center", justifyContent: "center", marginTop: 12 },
  socialText: { color: C.text, fontSize: 15, fontWeight: "400" },
  error: { color: C.error, fontSize: 13, textAlign: "center", marginTop: 14 },
  codeRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 8 },
  codeBox: { width: 46, height: 58, borderRadius: 14, borderWidth: 0.5, borderColor: C.hair, alignItems: "center", justifyContent: "center" },
  codeBoxActive: { borderColor: C.accent },
  codeDigit: { color: C.text, fontSize: 24, fontWeight: "300" },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  resend: { color: C.faint, fontSize: 14, textAlign: "center", letterSpacing: 0.3 },
});
