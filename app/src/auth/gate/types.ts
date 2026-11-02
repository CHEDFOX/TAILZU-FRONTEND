/** What the gate works with: a sign-in method, the one being verified, and the looks the server may give a pill. */
export interface Field { id: string; type: "email" | "phone" }
export interface ActiveMethod { type: "email" | "phone"; value: string }

export type PillLook = {
  height?: number; radius?: number;
  background?: string; borderColor?: string; textColor?: string;
  placeholderColor?: string; badgeBackground?: string; badgeBorderColor?: string;
  targetBackground?: string; targetIconColor?: string;
  fontSize?: number; paddingLeft?: number;
};

/**
 * What the onboarding sign-in asks of a pill beyond its look: a plain field
 * with a button under it instead of a swipe. Every key is optional; a pill
 * that is sent none of them is the pill it always was, which is what the
 * native screen and today's server tree keep drawing.
 */
export type FieldLook = {
  variant?: "field";
  submitLabel?: string;
  placeholder?: string;
  /** Phone: the country the number box opens on when the device's own is not on the list. */
  presetCountry?: string;
  buttonBackground?: string; buttonTextColor?: string; buttonHeight?: number; buttonRadius?: number;
  countryBackground?: string; countryBorderColor?: string;
};
