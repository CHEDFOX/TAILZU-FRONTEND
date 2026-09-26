/**
 * What this renderer build can draw + do. Sent to the server in the capability
 * handshake so it never emits a node/action we can't handle.
 *
 * This list is the KITCHEN-SINK build — every component/action we might want
 * to server-drive within 12 months. The renderer implementations live in
 * components.tsx (nodes) and actions.ts (actions).
 *
 * THE LIST IS A PROMISE, SO IT ONLY NAMES WHAT ACTUALLY WORKS. The server
 * withholds anything this bundle does not advertise and draws a fallback
 * instead — which is exactly right for a placeholder, and exactly wrong for a
 * real component that was simply never added here. So:
 *
 *   - registered components are listed (FlipText, ChatThread, … were drawn
 *     all along but never advertised, so the server could not rely on them);
 *   - placeholders are NOT listed (Audio, Camera, QRScanner, LottieAnimation,
 *     SwipeableRow and Tabs render a stand-in, not the thing) — they stay in
 *     the registry so an old screen still draws something, and come back here
 *     the day they are real;
 *   - actions that do nothing (playMedia, keyboard.reload, keyboard.setLayout)
 *     are not listed either, and the implemented ones that were missing are.
 */
export const CORE_COMPONENTS = [
  // v1 primitives
  "Screen", "Stack", "Spacer", "Text", "Image", "Icon", "Button",
  "TextField", "Chip", "Card", "List", "Divider", "ProgressBar", "VoiceButton",

  // v2 content blocks
  "Overline", "Heading", "Paragraph", "Quote", "Badge", "KeyValue", "Hero",

  // v2 playground controls
  "VoiceToggle", "RefineButton", "DraftButton", "Pager",

  // v2 settings row + dictionary
  "Row",
  "DictionaryEditor", "WordChips", "LanguageGreetingGrid", "FlipText",

  // v3 layout / navigation
  "Grid", "MasonryGrid", "Modal", "BottomSheet", "ActionSheet",
  "Popover", "Tooltip", "Collapsible", "StickyHeader",
  "PullToRefresh", "SafeArea",

  // v3 inputs
  "Switch", "Slider", "Stepper", "SegmentedControl", "SearchField",
  "Picker", "DatePicker",

  // v3 data viz
  "LineChart", "BarChart", "Sparkline", "ProgressRing", "Gauge",
  "StatCard", "Waveform", "PieChart", "DonutChart",

  // v3 media
  "Video", "ImagePickerButton",
  "Avatar", "AvatarStack",
  // Slideshow — cycles through a MediaSpec[] at a backend-defined speed.
  // Powers intro sequences, paywall carousels, onboarding walkthroughs.
  "Slideshow",
  // ParticleMark — the brand mark bursting into particles and re-forming, on a
  // loop. The keyboard's recording visual, ported off Swift so the app can use
  // it too (see ParticleMark.tsx).
  "ParticleMark",
  // KeyboardPreview — a real keyboard, drawn as one component. Powers the
  // haptics picker, where the user chooses keys by pointing at where their
  // thumbs go, so a reflowed list of chips would not do.
  "KeyboardPreview",
  // BinaryReveal — a wordmark decoding itself out of 0s and 1s, on a loop.
  "BinaryReveal",
  // MorphOut — the opening scene drawn into the mic it becomes, so the intro
  // hands over to home as one object rather than two.
  "MorphOut",
  // WordMeter — the free plan's words, and the ones the user has earned. The
  // track grows as they are earned, so the reward is the bar itself.
  "WordMeter",

  // v3 feedback
  "Toast", "Snackbar", "LoadingSkeleton", "Confetti", "Rating",
  "EmptyState", "Countdown",

  // SwipeAction — a pill whose disc is dragged to the far end to commit. The
  // sign-in pills' gesture, made general.
  "SwipeAction",
  /**
   * NOT A COMPONENT — a declaration that this bundle's Screen honours
   * `holdTouches`, i.e. that it can carry a draggable control without the
   * scroll stealing the gesture. The backend withholds any screen that needs
   * it from a bundle that does not say this, rather than shipping one whose
   * way in does nothing.
   */
  "ScreenHoldTouches",
  // Coverflow — a deck of cards turned in depth, dragged and thrown.
  // Reels — one child per screenful, snapped vertically.
  "Coverflow", "Reels",
  // AuroraOrb — the spoken screen's sphere, drawn as one Skia fragment shader.
  // Supersedes VoiceBubble, which stays registered as its fallback.
  "AuroraOrb",
  // The spoken screen and the thread it writes into.
  "ChatThread", "VoiceBubble", "VoiceSession",
  // The sign-in screen's pieces, drawn from the server's auth tree.
  "SwipePill", "AppleSignIn", "GoogleSignIn", "CodeEntry", "AuthPhase",
  // Entrance motion, and the neural field backdrop.
  "Rise", "NeuralField",

  // v3 meta / helpers
  "WebView", "SVG", "Gradient", "BlurBackground", "QRCode",
  "IfElse", "ForEach", "Portal",
] as const;

export const CORE_ACTIONS = [
  // nav & flow
  "navigate", "navigateBack", "switchTab", "openUrl", "openSettings",
  "openInAppBrowser", "dismiss",
  // data
  "callEndpoint", "refresh",
  // state
  "setState", "toggleState", "incrementState", "clearState",
  "toggleInArray", "appendState",
  // feedback
  "haptic", "toast", "snackbar", "stopMedia", "speak", "confetti",
  // system / share / clipboard
  "share", "shareFile", "copyToClipboard", "readClipboard",
  "sms", "email", "phone", "download", "saveToPhotos",
  // media pickers
  "pickImage", "pickDocument", "scanQR",
  // permissions
  "requestPermission", "checkPermission",
  // auth
  "biometricPrompt", "signOut",
  // app-level chrome — swap the alternate app icon at runtime
  // IAP
  "iap.showPaywall", "iap.subscribe", "iap.restore", "iap.checkEntitlement",
  // notifications
  "scheduleNotification", "cancelNotification", "requestPushPermission",
  // analytics
  "analytics.track", "analytics.identify", "analytics.reset",
  // calendar
  "calendar.addEvent",
  // review
  "requestReview",
  // mic handoff — main app records + refines, keyboard inserts (see
  // targets/keyboard/TulmiHandoff.swift and modules/tulmi-bridge).
  "completeKeyboardHandoff", "cancelKeyboardHandoff", "armFlowSession", "endFlowSession",
  // cache / dev
  "clearCache", "reloadApp",
  // composition
  "sequence", "parallel", "condition", "delay", "log",
] as const;

/** Named layouts the app can compose from `template` + `blocks`. */
export const CORE_TEMPLATES = [
  "scroll", "feature", "list", "centered", "detail", "grid", "hero",
] as const;
