/** Connection: the developer's backend-URL screen (client-local; needed to reach the server at all). */
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { errorDetail } from "../client";
import { txt } from "../knobs";
import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from "../../storage";
import * as api from "../../api";
import { restorePurchases, isBillingEnabled } from "../../billing/purchases";
import { styles } from "./styles";

export function ConnectionScreen({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [url, setUrl] = useState(DEFAULT_BASE_URL);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restoreState, setRestoreState] = useState<"idle" | "running" | "done" | "off">(
    isBillingEnabled() ? "idle" : "off",
  );

  useEffect(() => {
    getBaseUrl().then(setUrl).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  async function test() {
    setStatus(txt("dev.connection.checking", "Checking…"));
    try {
      await setBaseUrl(url);
      const h = await api.health();
      setStatus(txt("dev.connection.ok", "OK — {service} v{version}", { service: h.service, version: h.version }));
    } catch (e: any) {
      // A developer screen: the raw detail IS the useful answer here.
      setStatus(txt("dev.connection.failed", "Cannot reach backend: {detail}", { detail: errorDetail(e) }));
    }
  }

  async function connect() {
    try {
      await setBaseUrl(url);
      onDone();
    } catch (e) {
      setStatus(txt("dev.connection.failed", "Cannot reach backend: {detail}", { detail: errorDetail(e) }));
    }
  }

  // Apple 3.1.1 requires an always-accessible restore path independent of the
  // server. This lives in the native shell so it's reachable even when the
  // backend is unreachable and every SDUI screen is empty.
  async function restore() {
    setRestoreState("running");
    try {
      await restorePurchases();
    } finally {
      setRestoreState("done");
    }
  }

  return (
    <View style={[styles.app, { backgroundColor: "#0e0e12", padding: 16, paddingTop: 64 }]}>
      <Text style={[styles.brand, { color: "#fff", marginBottom: 16 }]}>{txt("dev.connection.title", "Connection")}</Text>
      <Text style={{ color: "#cfcfe0", marginBottom: 6 }}>{txt("dev.connection.urlLabel", "Backend URL")}</Text>
      <TextInput
        value={loaded ? url : ""}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={txt("dev.connection.urlPlaceholder", "http://10.0.2.2:8770 or https://your-vps")}
        placeholderTextColor="#8a8a96"
        style={styles.input}
      />
      <Text style={{ color: "#8a8a96", fontSize: 13, marginTop: 8 }}>
        {txt("dev.connection.help", "Emulator → your PC = http://10.0.2.2:8770. Physical phone → your PC's LAN IP, or your VPS URL.")}
      </Text>
      <View style={{ height: 16 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#FFFFFF" }]} onPress={connect}>
        <Text style={[styles.btnText, { color: "#000000" }]}>{txt("dev.connection.connect", "Connect")}</Text>
      </Pressable>
      <View style={{ height: 8 }} />
      <Pressable style={[styles.btn, { backgroundColor: "#3a3a44" }]} onPress={test}>
        <Text style={styles.btnText}>{txt("dev.connection.test", "Test connection")}</Text>
      </Pressable>
      {onCancel && (
        <>
          <View style={{ height: 8 }} />
          <Pressable style={[styles.btn, { backgroundColor: "transparent" }]} onPress={onCancel}>
            <Text style={[styles.btnText, { color: "#8a8a96" }]}>{txt("dev.connection.cancel", "Cancel")}</Text>
          </Pressable>
        </>
      )}
      {!!status && <Text style={{ color: "#9b9bd0", marginTop: 12 }}>{status}</Text>}

      {restoreState !== "off" && (
        <>
          <View style={{ height: 24, borderBottomWidth: 1, borderBottomColor: "#2a2a36" }} />
          <Text style={{ color: "#cfcfe0", marginTop: 20, marginBottom: 6, fontWeight: "600" }}>
            {txt("dev.connection.subscription", "Subscription")}
          </Text>
          <Pressable
            style={[styles.btn, { backgroundColor: "#2a2a36" }]}
            onPress={restore}
            disabled={restoreState === "running"}
          >
            <Text style={styles.btnText}>
              {restoreState === "running"
                ? txt("iap.restore.running", "Restoring…")
                : txt("iap.restore.action", "Restore Purchases")}
            </Text>
          </Pressable>
          {restoreState === "done" && (
            <Text style={{ color: "#9b9bd0", marginTop: 10, fontSize: 13 }}>
              {txt("iap.restore.done", "Restore complete. If your subscription was on this Apple ID, it's active again.")}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
