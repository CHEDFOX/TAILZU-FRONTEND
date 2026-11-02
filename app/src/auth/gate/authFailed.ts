import { Alert } from "react-native";
import { bool } from "../../sdui/knobs";

/**
 * A sign-in that failed, told to the person in the server's words.
 *
 * The raw reason (Supabase's message, a Google error code) used to be the
 * alert's body — accurate, and meaningless to anyone but us. It goes to the
 * log now; the server can put it back on screen with auth.errors.showDetail
 * while a provider is being set up.
 */
export function authFailed(title: string, body: string, detail: unknown): void {
  const raw = String((detail as { message?: string } | null)?.message ?? detail ?? "");
  console.warn(`[auth] ${title}: ${raw}`);
  Alert.alert(title, bool("auth.errors.showDetail", false) && raw ? `${body}\n\n${raw}` : body);
}
