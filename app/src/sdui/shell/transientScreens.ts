import { list } from "../knobs";

/**
 * Screens that only make sense while the keyboard is driving — the mic
 * handoff and the Flow arming screen. A normal open must never land on one,
 * and "back" from one with nothing under it goes home.
 */
export const transientScreenIds = () =>
  list<string>("nav.transientScreenIds", ["keyboard_record", "keyboard_primer", "flow_arm"]);
