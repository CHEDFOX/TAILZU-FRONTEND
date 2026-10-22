/**
 * How far the code step rides up when the number pad opens.
 *
 * The one-pill code entry sits at the foot of its screen, so it lifts by the
 * keyboard's height less the overlap it keeps with the keyboard's top. The
 * onboarding's boxes (variant "boxes") do not: they sit near the top of the
 * step, under Blip and the heading, and the step's scroll view already makes
 * room for the keyboard by itself. Lifting them by a keyboard height would
 * throw them off the top of the screen, over Blip and the progress bar, so
 * they never lift.
 */
export function codeLiftTarget(o: {
  boxes: boolean;
  focused: boolean;
  kbHeight: number;
  overlap: number;
}): number {
  if (o.boxes) return 0;
  if (!o.focused || !(o.kbHeight > 0)) return 0;
  return -(o.kbHeight - o.overlap);
}
