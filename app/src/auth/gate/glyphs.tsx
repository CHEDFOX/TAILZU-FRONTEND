/** The gate's glyphs (Plutto's exact paths). */
import Svg, { Path, Rect } from "react-native-svg";
import { WHITE } from "./look";

export const Envelope = ({ c = WHITE }: { c?: string }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24">
    <Rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke={c} strokeWidth="1.6" fill="none" />
    <Path d="M3.5 7 L12 13 L20.5 7" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const PhoneMark = ({ c = WHITE }: { c?: string }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24">
    <Path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.3 1l-2.2 2.2z" fill={c} />
  </Svg>
);
export const Arrow = ({ c = "#000" }: { c?: string }) => (
  // Short shaft, big head, thick round caps. A long thin arrow reads as a
  // hairline inside a 46pt circle; this one has to look pressable at a glance.
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path d="M6 12h11M12 7l5 5-5 5" stroke={c} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const Chevron = ({ c = "rgba(255,255,255,0.5)" }: { c?: string }) => (
  <Svg width={12} height={12} viewBox="0 0 24 24">
    <Path d="M6 9l6 6 6-6" stroke={c} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const AppleMark = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path fill={WHITE} d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.46 1.58-1.51 3.14-.9 1.36-1.84 2.71-3.32 2.71-1.48 0-1.86-.88-3.56-.88-1.66 0-2.25.91-3.6.91-1.36 0-2.3-1.27-3.22-2.61-1.87-2.61-3.34-7.53-1.42-10.86.95-1.66 2.65-2.7 4.5-2.73 1.4-.03 2.72.95 3.58.95.85 0 2.45-1.18 4.12-1.01.7.03 2.67.28 3.93 2.13-.1.06-2.35 1.37-2.33 4.07.03 3.22 2.83 4.29 2.86 4.31z" />
  </Svg>
);
// Google "G" in its four brand colors (official multicolor mark).
export const GoogleMark = () => (
  <Svg width={20} height={20} viewBox="0 0 48 48">
    <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </Svg>
);
export const Back = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M15 6l-6 6 6 6" stroke="rgba(255,255,255,0.55)" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const Resend = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" stroke="rgba(255,255,255,0.55)" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
