/**
 * AuthFlowContext — the sign-in flow, exposed so something else can draw it.
 *
 * The auth screen is the one screen in the app the server does not compose.
 * That is not a technical limit — bootstrap reaches the app before there is a
 * session, which is how the backdrop arrives — it is simply that the pills,
 * the country sheet and the native sign-in buttons are not in the component
 * registry, and components live in the binary.
 *
 * This is how that gets fixed WITHOUT touching the flow. AuthGateScreen keeps
 * owning every piece of logic it owns today: the sequence guard that stops a
 * stale response overwriting a fresh one, the review-address path, the captcha,
 * the error recovery that drops back to the code screen rather than stranding
 * anyone on a spinner. None of that moves. It is only published here, so an
 * SDUI tree can render the same flow.
 *
 * The rule that keeps this safe: everything in this file is presentation-facing
 * state and handlers. No auth decision is made here, and nothing here may be
 * the only copy of anything. If the SDUI path is turned off, the native screen
 * still works because the native screen is still the thing doing the work.
 */
import React, { createContext, useContext } from "react";

export type AuthPhase = "entry" | "sending" | "verify" | "verifying";
export type AuthMethodType = "email" | "phone";

export type AuthFlow = {
  /** Where the flow is. The SDUI screens gate their nodes on this. */
  phase: AuthPhase;
  /** What is being verified, once a code has been sent. */
  active: { type: AuthMethodType; value: string } | null;

  /** The code being typed, and the length the flow expects. */
  code: string;
  codeLength: number;
  setCode: (next: string) => void;
  /** True for the ~400ms after a wrong code, so a pill can go red and shake. */
  codeError: boolean;

  /** Which methods this build and this backend actually offer. */
  phoneEnabled: boolean;
  appleAvailable: boolean;
  googleEnabled: boolean;

  /** Send a code. The screen decides what that means per method. */
  submit: (type: AuthMethodType, value: string) => void;
  /** Verify a typed code. Called automatically when the code is complete. */
  verify: (code: string) => void;
  /** Send the same code again to the same address. */
  resend: () => void;
  /** Back to the entry screen from the code screen. */
  back: () => void;

  signInApple: () => void;
  signInGoogle: () => void;

  /** Put the caret in the code field. */
  focusCode: () => void;
};

const Ctx = createContext<AuthFlow | null>(null);

export const AuthFlowProvider = Ctx.Provider;

/**
 * Read the flow. Returns null outside a provider rather than throwing — an SDUI
 * auth component that somehow renders on another screen should draw nothing,
 * not crash the screen it landed on.
 */
export function useAuthFlow(): AuthFlow | null {
  return useContext(Ctx);
}
