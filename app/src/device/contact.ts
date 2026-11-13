/** The system contact picker, through natives.ts (TulmiPerms.pickEmail). No permission; an older binary has no module -> "error". */
import { tulmiPerms } from "./natives";
import { pickContactEmail } from "./contactCore";

export function runContactPick() {
  const m = tulmiPerms();
  return pickContactEmail(m?.pickEmail ? () => m.pickEmail!() : undefined);
}
