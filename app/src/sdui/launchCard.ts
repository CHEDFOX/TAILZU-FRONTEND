/**
 * Which launch cards this install has already been shown.
 *
 * The backend decides WHAT a card says, WHEN it exists and WHETHER it repeats.
 * The one fact it cannot know is whether this phone has seen it, because that
 * is a property of the install, not the account — the same person on a new
 * phone should get the announcement again. So the id lands here and nowhere
 * else.
 *
 * Ids are kept as a list rather than a single "last seen": a card can be
 * withdrawn and brought back, and someone who dismissed it the first time
 * should not be shown it twice for one id.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "tulmi.launchCard.seen";
/** Enough for years of announcements; oldest fall off the front. */
const MAX_REMEMBERED = 40;

async function read(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    // Unreadable store, or JSON someone else wrote. Treat as "seen nothing":
    // showing a card twice is a smaller failure than never showing one.
    return [];
  }
}

export async function hasSeenCard(id: string): Promise<boolean> {
  if (!id) return true;
  return (await read()).includes(id);
}

export async function markCardSeen(id: string): Promise<void> {
  if (!id) return;
  try {
    const list = await read();
    if (list.includes(id)) return;
    await AsyncStorage.setItem(KEY, JSON.stringify([...list, id].slice(-MAX_REMEMBERED)));
  } catch {
    // A card shown again on the next open is the cost of a failed write, and
    // it is not worth a crash on app start.
  }
}
