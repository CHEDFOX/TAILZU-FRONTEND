/**
 * What the person has typed, kept for as long as the gate is up. The sign-in
 * step is a layer that is taken away when the code step glides in, so coming
 * back to correct one character ("Change it") would otherwise find an empty
 * field. Cleared when the gate goes, so the next person on this phone does not
 * find the last one's address.
 */
export const typedMemory = new Map<string, string>();
