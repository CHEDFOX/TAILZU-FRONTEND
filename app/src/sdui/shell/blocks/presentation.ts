/**
 * HOW A SCREEN COMES UP (pure SPEC 2.10): `navigate` takes `presentation: push | sheet | modal | overlay | fade`, sheet `detents`, and a
 * `transition`. Today's navigate (a plain push) is the default and stays so: every value here that is missing or wrong gives "push".
 * Tested in presentation.test.ts. V1's navigate action passes these to the shell.
 */
import { normalizeDetents } from "./sheetMath.ts";

export const PRESENTATIONS = ["push", "sheet", "modal", "overlay", "fade"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

/** The few transitions the shell itself can play. Anything else is the motion block's (B4), given as a motion value. */
export const TRANSITIONS = ["default", "slide", "fade", "none"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export interface PresentSpec { presentation: Presentation; detents?: number[]; transition: Transition; /** A B4 motion value kept as given, for the motion block. */ motion?: Record<string, unknown>; dismissible: boolean }

export function normalizePresentation(a: unknown): PresentSpec {
  const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
  const presentation = (PRESENTATIONS as readonly string[]).includes(o.presentation as string) ? (o.presentation as Presentation) : "push";
  const transition = (TRANSITIONS as readonly string[]).includes(o.transition as string) ? (o.transition as Transition) : presentation === "fade" ? "fade" : "default";
  const motion = o.transition && typeof o.transition === "object" && !Array.isArray(o.transition) ? (o.transition as Record<string, unknown>) : undefined;
  return {
    presentation, transition,
    ...(motion ? { motion } : {}),
    ...(presentation === "sheet" ? { detents: normalizeDetents(o.detents) } : {}),
    dismissible: o.dismissible !== false,
  };
}

/** Whether the shell must draw it over the screen below (anything but a push). */
export const isOverlayLike = (p: Presentation): boolean => p !== "push";
