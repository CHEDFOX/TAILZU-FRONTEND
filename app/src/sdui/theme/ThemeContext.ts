/** The theme tokens every node resolves its colours, spacing and type against (SduiApp and the sign-in gate provide it). */
import { createContext, useContext } from "react";
import type { ThemeTokens } from "../types";

export const ThemeContext = createContext<ThemeTokens | null>(null);
export const useTheme = (): ThemeTokens => {
  const t = useContext(ThemeContext);
  if (!t) throw new Error("ThemeContext missing");
  return t;
};
