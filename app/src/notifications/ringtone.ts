/**
 * THE RINGTONE, EVERYWHERE BUT THE IPHONE (ringtone.ios.ts is the iPhone's). An Android notification sound has to be a raw
 * resource packed into the binary at build time (expo-notifications resolves only res/raw), which an update cannot add, so
 * Android rings on its "calls" channel with the default sound and a call-like vibration (calls.ts makeCallChannels). The tone
 * stays in the repo (assets/sounds/x0_ring_1.wav) for a store build to pack, on a channel of its own ("calls_ring").
 */

/** Never: there is no tone to install here, and the push token never says BotRingtone. */
export function ringtoneReady(_timeoutMs?: number): Promise<boolean> {
  return Promise.resolve(false);
}
