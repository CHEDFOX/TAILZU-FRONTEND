/**
 * What a field inside a bot's open thought may ask of it (BotStage.tsx provides it, MentionField.tsx uses it): close the
 * thought, as a tap outside would. A composer left empty when its keyboard goes closes the box it opened.
 */
import { createContext } from "react";

export interface ThoughtControl {
  /** Close the open thought (openPath false, then the stage's on.onDismiss), as the person closing it. */
  close(): void;
}

export const ThoughtContext = createContext<ThoughtControl | null>(null);
