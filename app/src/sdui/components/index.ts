/**
 * The node components, by the `type` the server names. Each lives in its own file here, or with the area that owns it
 * (the sign-in's in src/auth/sdui, the onboarding's in src/onboard, the bots' in ../bots).
 *
 * ThemeContext and typeRole are re-exported because the render check in TAILZU-BACKEND (scripts/bots-render) imports
 * them from this module.
 */
import type React from "react";
import type { CompProps } from "./props";
import { Grid } from "./Grid";
import { SafeArea } from "./SafeArea";
import { SVGC } from "./Svg";
import { Screen } from "./Screen";
import { Stack } from "./Stack";
import { TextC } from "./Text";
import { ImageC } from "./Image";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { VoiceButton } from "./VoiceButton";
import { VoiceToggle } from "./morphControls";
import { Rise } from "./Rise";
import { MorphOut } from "./MorphOut";
import { LiveView } from "./LiveView";
import { SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase } from "../../auth/sdui";
import { OnboardStage } from "../../onboard/OnboardStage";
import { BlipSpot } from "../../onboard/BlipSpot";
import { BlipWalkOut } from "../../onboard/BlipWalkOut";
import { BotTiles } from "../bots/BotTiles";
import { BotCard } from "../bots/BotCard";
import { BotBuddy } from "../bots/BotBuddy";
import { HeadBar, LiveMarkNode, WriteOn } from "../bots/HomeHead";

export { ThemeContext } from "../theme/ThemeContext";
export { typeRole } from "../theme/typeRole";
export type { CompProps } from "./props";

/**
 * Every node type this build draws: the Bots app's (its kit, the sign-in's
 * pieces, the keyboard handoff screens' mic) and nothing else. A type that is
 * not here draws its `fallback`, or nothing.
 *
 * Button stays for the bootstrap's launch card (SduiApp's LaunchCardOverlay),
 * which the server still builds from Text and Button.
 */
export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  // The Bots kit's layout and drawing.
  Grid, SafeArea, SVG: SVGC,
  Screen, Stack, Text: TextC, Image: ImageC, Button, TextField,
  // The keyboard handoff screens' mic and dictation (keyboard_record, keyboard_primer, flow_arm).
  VoiceButton, VoiceToggle,
  // The sign-in (auth.screen; authRender.tsx) and the onboarding run around it.
  SwipePill, AppleSignIn, GoogleSignIn, CodeEntry, AuthPhase, OnboardStage, BlipSpot,
  // Entrance motion, and the opening scene drawn into what it becomes.
  Rise, MorphOut,
  // The bots: Home's tiles, the card with one on top, a bot's own tiny bot, Home's welcome.
  BotTiles, BotCard, BotBuddy, BlipWalkOut,
  // Home's header, alive (HomeHead.tsx).
  WriteOn, LiveMark: LiveMarkNode, HeadBar,
  // A running page or artifact, sandboxed (LiveView.tsx).
  LiveView,
};
