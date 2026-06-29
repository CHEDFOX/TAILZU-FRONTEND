/**
 * What this renderer build can draw + do. Sent to the server in the capability
 * handshake so it never emits a node/action we can't handle.
 */
export const CORE_COMPONENTS = [
  "Screen", "Stack", "Spacer", "Text", "Image", "Icon", "Button",
  "TextField", "Chip", "Card", "List", "Divider", "ProgressBar", "VoiceButton",
  // SDUI v2 content blocks (editorial / Plutto-style):
  "Overline", "Heading", "Paragraph", "Quote", "Badge", "KeyValue", "Hero",
  // Morphing playground controls (Home):
  "VoiceToggle", "RefineButton", "DraftButton", "Pager",
  // Settings / list row:
  "Row",
  // Dictionary (keyboard text-expansion) + frequent words:
  "DictionaryEditor", "WordChips",
] as const;

export const CORE_ACTIONS = [
  "navigate", "navigateBack", "switchTab", "openUrl", "openSettings", "dismiss",
  "callEndpoint", "refresh", "setState", "toggleState", "haptic",
  "toast", "playMedia", "speak", "signOut", "sequence", "condition",
] as const;

/** Named layouts the app can compose from `template` + `blocks`. */
export const CORE_TEMPLATES = ["scroll", "feature", "list", "centered"] as const;
