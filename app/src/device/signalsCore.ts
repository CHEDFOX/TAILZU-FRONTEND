/**
 * The one rule about what the server may be told about the keyboard. Pure, so it can be tested without a phone.
 *
 * WHY IT IS ITS OWN FILE. On the iPhone, "is the X0 Bot keyboard added" has two possible sources, and they are not
 * interchangeable:
 *
 *   - the SYSTEM'S keyboard list (AppleKeyboards in UserDefaults.standard, read by TulmiBridgeModule.swift). It is
 *     written by iOS, not by this app, and it answers the moment the keyboard is turned on, whether or not it has
 *     ever run. The privacy manifest declares it under NSPrivacyAccessedAPICategoryActiveKeyboards with reasons
 *     54BD.1 and 3EC4.1, and both say: "Information accessed for this reason, or any derived information, may not be
 *     sent off-device." Reason CA92.1, for UserDefaults, adds that it "does not permit reading information that was
 *     written by other apps or the system". So this reading, and anything derived from it, stays on the phone.
 *   - the KEYBOARD'S OWN HEARTBEAT (tulmi.kb.lastActive, written by KeyboardViewController into the App Group). That
 *     is this app's own value in its own container, covered by reason 1C8F.1, and it may leave the phone.
 *
 * The bootstrap used to send the first one, which is what reasons 54BD.1 and 3EC4.1 forbid. It now sends the second,
 * under the same field name (`keyboardEnabled`) so the server's routing is unchanged. The cost is honest and small:
 * the heartbeat only appears once the keyboard has really run in a text field, so someone who has added it in
 * Settings and come straight back is still offered the walkthrough — the conservative direction, which is what
 * capabilities.ts wanted anyway (a step offered twice costs a tap; a step skipped leaves the keyboard never used).
 *
 * ANDROID HAS NO SUCH RULE and no heartbeat: TulmiBridgeModule.kt answers `enabled` from the system's enabled-IME
 * list and always reports lastActiveMs 0, so Android keeps sending `enabled` or it would say "not enabled" forever.
 */

/** The keyboard half of a device reading, as signals.ts holds it. Null when the native bridge did not answer. */
export interface KeyboardReading {
  enabled: boolean;
  fullAccess: boolean;
  /** iPhone: epoch-ms the keyboard extension last ran. Android: always 0. */
  lastActiveMs: number;
}

/**
 * What the bootstrap's `device.keyboardEnabled` may say. iPhone: the App Group heartbeat only. Android: the reading
 * as it stands. A bridge that did not answer reads false, as it did before.
 */
export function keyboardEnabledOffDevice(platform: string, keyboard: KeyboardReading | null): boolean {
  if (!keyboard) return false;
  if (platform === "ios") return keyboard.lastActiveMs > 0;
  return keyboard.enabled;
}
