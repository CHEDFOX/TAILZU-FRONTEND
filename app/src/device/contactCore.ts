/**
 * "ADD FROM CONTACTS", THE RULES (perms/SPEC.md 3). Pure, so it is tested in Node (contactCore.test.ts).
 *
 * The system's own contact picker runs outside the app and hands back the ONE email the person tapped. No permission, no card,
 * and the address book is never read. Only that email reaches state, and nothing is sent until the person taps Send.
 */

/** An email the invite box could hold: one address, trimmed, no spaces or angle-bracket names, at most 254 characters. */
export function pickedEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 3 || s.length > 254) return null;
  if (/\s|[<>,;]/.test(s)) return null;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(s) ? s : null;
}

export type PickOutcome = "picked" | "cancel" | "error";

/** The contact.pick action: the picker's answer as an outcome (and the email when picked). */
export async function pickContactEmail(
  pick: (() => Promise<string | null>) | undefined,
): Promise<{ outcome: PickOutcome; email?: string }> {
  if (!pick) return { outcome: "error" };
  try {
    const got = await pick();
    if (got == null || got === "") return { outcome: "cancel" };
    const email = pickedEmail(got);
    return email ? { outcome: "picked", email } : { outcome: "error" };
  } catch {
    return { outcome: "error" };
  }
}
