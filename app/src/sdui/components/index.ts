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
import { Scroll } from "./Scroll";
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
import { BotStage } from "../bots/BotStage";
import { BotCrowd } from "../bots/BotCrowd";
import { Vanish } from "./Vanish";
import { MentionField } from "./MentionField";
import { LiveWords } from "./LiveWords";
import { PersonBot } from "../bots/PersonBot";
// Lists, inputs and media (pure/SPEC.md 2.6, 2.8, 2.10). Registered by registerListsInputsMedia below, not here.
import { List } from "./List";
import { Each } from "./Each";
import { Input } from "./input/Input";
import { Video } from "./Video";
import { AudioNode } from "./Audio";
import { Camera } from "./Camera";

export { ThemeContext } from "../theme/ThemeContext";
export { typeRole } from "../theme/typeRole";
export type { CompProps } from "./props";

/**
 * Every node type this build draws: the Bots app's (its kit, the sign-in's
 * pieces, the keyboard handoff screens' mic) and nothing else. A type that is
 * not here draws its `fallback`, or nothing.
 *
 * Button stays for the bootstrap's launch card (shell/LaunchCardOverlay),
 * which the server still builds from Text and Button.
 */
export const REGISTRY: Record<string, React.ComponentType<CompProps>> = {
  // The Bots kit's layout and drawing.
  Grid, SafeArea, SVG: SVGC,
  // A box that scrolls on its own inside a card (the terms and privacy card).
  Scroll,
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
  // Spaces, the family redesign (types.ts 3i): a bot with a thought, a crowd of tiny bots, a row that vaporises, a message
  // field with @ and /, and the words of a voice session as they are heard.
  BotStage, BotCrowd, Vanish, MentionField, LiveWords,
  // A person, as their own tiny bot (types.ts 3j).
  PersonBot,
};

/**
 * LISTS, INPUTS AND MEDIA — OFF UNTIL THE RENDERER TURNS THEM ON (pure/SPEC.md 2.0, principle 2; 2.6, 2.8, 2.10).
 *
 * These six node types are not in REGISTRY above, on purpose. A block must be off for a screen unless the client
 * declared it and the screen asked for it, and what the client declares is built from what the registry holds — so
 * adding them here would declare them to the server before the renderer can draw them (they need the host in
 * v3Host.ts to render a row, write a value or fetch a page, and that is V1's to provide).
 *
 * V1 calls this once, with the real host in place. Then, and only then, does the phone say it has `list`, `input`
 * and `media`. The contract for all six is in v3Spec.ts.
 */
export function registerListsInputsMedia(registry: Record<string, React.ComponentType<CompProps>>): void {
  registry.List = List;
  registry.Each = Each;
  registry.Input = Input;
  registry.Video = Video;
  registry.Audio = AudioNode;
  registry.Camera = Camera;
}

export { SPEC as LISTS_INPUTS_MEDIA_SPEC, BLOCK_NODES } from "./v3Spec";
export { V3HostContext, ScreenScrollerContext } from "./v3Host";
export type { V3Host, ListHost, InputHost, MediaHost, ItemScope, ScreenScrollerSlot } from "./v3Host";
export { screenListPlan } from "./listCore";
