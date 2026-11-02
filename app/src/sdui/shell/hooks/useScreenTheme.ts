import { useMemo } from "react";
import type { BootstrapResponse, ScreenResponse, ThemeTokens } from "../../types";

/** The theme in force: the app's, with the screen's colour, spacing, radius and type groups merged over it. */
export function useScreenTheme({ boot, screen }: { boot: BootstrapResponse | null; screen: ScreenResponse | null }) {
  // A screen's theme overrides the app's group by group — colours, spacing,
  // radii and type — each merged one level deep. Only `color` used to be
  // merged, so a screen that set its own spacing or type scale was ignored.
  const theme: ThemeTokens | null = useMemo(() => {
    if (!boot) return null;
    const st = screen?.theme;
    if (!st) return boot.theme;
    return {
      ...boot.theme,
      color: { ...boot.theme.color, ...(st.color ?? {}) },
      space: { ...boot.theme.space, ...(st.space ?? {}) },
      radius: { ...boot.theme.radius, ...(st.radius ?? {}) },
      font: { ...boot.theme.font, ...(st.font ?? {}) },
    };
  }, [boot, screen]);
  return theme;
}
