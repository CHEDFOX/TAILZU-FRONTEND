/**
 * The auth gate — a client-local screen shown before the app when there's no
 * Supabase session (the app needs a JWT to talk to the backend, so this can't
 * be server-driven like the other screens).
 *
 * Email + password today. Google / Apple are deferred until their per-app OAuth
 * credentials exist (a different bundle id + a new Supabase project both need
 * fresh credentials), so they show as "coming soon" rather than failing.
 */
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { resetPassword, signInWithPassword, signUp } from "./auth";

// Palette mirrors the server THEME (catalog.ts) so the gate matches the app.
const C = {
  bg: "#0a0a0d",
  surface: "#101015",
  inputBg: "#16161d",
  border: "rgba(255,255,255,0.10)",
  primary: "#FFFFFF",
  text: "rgba(255,255,255,0.94)",
  body: "rgba(255,255,255,0.72)",
  muted: "rgba(255,255,255,0.55)",
  label: "rgba(255,255,255,0.38)",
  danger: "#e0556b",
  success: "#4caf50",
};

type Mode = "signin" | "signup";

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const canSubmit = emailOk && password.length >= 6 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signup") {
        const { session, needsConfirmation } = await signUp(email.trim(), password);
        if (needsConfirmation || !session) {
          setNotice("Account created. Check your email to confirm, then sign in.");
          setMode("signin");
          setPassword("");
        } else {
          onAuthed();
        }
      } else {
        await signInWithPassword(email.trim(), password);
        onAuthed();
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!emailOk) {
      setError("Enter your email first, then tap “Forgot password”.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await resetPassword(email.trim());
      setNotice("Password reset email sent. Check your inbox.");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't send the reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.overline}>Voice · Refine · Reply</Text>
        <Text style={styles.brand}>Tulmi</Text>
        <Text style={styles.subtitle}>
          {mode === "signin"
            ? "Welcome back. Sign in to continue."
            : "Create an account to make every word sound like you."}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={C.label}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          style={styles.input}
        />

        <View style={{ height: 12 }} />
        <Text style={styles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={C.label}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          textContentType={mode === "signup" ? "newPassword" : "password"}
          style={styles.input}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {mode === "signin" && (
          <Pressable onPress={forgot} hitSlop={8} style={{ alignSelf: "flex-end", marginTop: 8 }}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
        )}

        {!!error && <Text style={styles.error}>{error}</Text>}
        {!!notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={{ height: 18 }} />
        <Pressable
          style={[styles.primaryBtn, { opacity: canSubmit ? 1 : 0.5 }]}
          onPress={submit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Text>
          )}
        </Pressable>

        {/* OAuth — present but deferred until per-app credentials exist. */}
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>
        <Pressable style={styles.oauthBtn} onPress={() => setNotice("Google sign-in is coming soon.")}>
          <Text style={styles.oauthText}>Continue with Google</Text>
          <Text style={styles.soon}>soon</Text>
        </Pressable>
        <View style={{ height: 10 }} />
        <Pressable style={styles.oauthBtn} onPress={() => setNotice("Apple sign-in is coming soon.")}>
          <Text style={styles.oauthText}>Continue with Apple</Text>
          <Text style={styles.soon}>soon</Text>
        </Pressable>

        <View style={{ height: 24 }} />
        <Pressable
          onPress={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError("");
            setNotice("");
          }}
          hitSlop={8}
          style={{ alignSelf: "center" }}
        >
          <Text style={styles.switchText}>
            {mode === "signin" ? (
              <>
                New here? <Text style={styles.link}>Create an account</Text>
              </>
            ) : (
              <>
                Already have an account? <Text style={styles.link}>Sign in</Text>
              </>
            )}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 24, paddingTop: 88, paddingBottom: 48 },
  overline: {
    color: C.label,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  brand: { color: C.text, fontSize: 40, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: C.body, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 32 },
  label: { color: C.label, fontSize: 13, letterSpacing: 0.3, marginBottom: 6 },
  input: {
    backgroundColor: C.inputBg,
    color: C.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 15,
  },
  link: { color: C.primary, fontWeight: "600" },
  error: { color: C.danger, marginTop: 14, fontSize: 14, lineHeight: 20 },
  notice: { color: C.success, marginTop: 14, fontSize: 14, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 24 },
  divider: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.muted, marginHorizontal: 12, fontSize: 13 },
  oauthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 50,
  },
  oauthText: { color: C.body, fontWeight: "600", fontSize: 15 },
  soon: {
    color: C.label,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginLeft: 8,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: "hidden",
  },
  switchText: { color: C.muted, fontSize: 14 },
});
