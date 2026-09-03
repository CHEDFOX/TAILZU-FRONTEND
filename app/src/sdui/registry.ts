/**
 * What this renderer build can draw + do. Sent to the server in the capability
 * handshake so it never emits a node/action we can't handle.
 *
 * This list is the KITCHEN-SINK build — every component/action we might want
 * to server-drive within 12 months. The renderer implementations live in
 * components.tsx (nodes) and actions.ts (actions).
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
  "DictionaryEditor", "WordChips", "LanguageGreetingGrid",

  // v3 layout / navigation
  "Grid", "MasonryGrid", "Modal", "BottomSheet", "ActionSheet",
  "Popover", "Tooltip", "Collapsible", "StickyHeader", "SwipeableRow",
  "PullToRefresh", "SafeArea", "Tabs",

  // v3 inputs
  "Switch", "Slider", "Stepper", "SegmentedControl", "SearchField",
  "Picker", "DatePicker",

  // v3 data viz
  "LineChart", "BarChart", "Sparkline", "ProgressRing", "Gauge",
  "StatCard", "Waveform", "PieChart", "DonutChart",

  // v3 media
  "Video", "Audio", "Camera", "QRScanner", "ImagePickerButton",
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

  // v3 feedback
  "Toast", "Snackbar", "LoadingSkeleton", "Confetti", "Rating",
  "EmptyState", "Countdown", "LottieAnimation",

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
  // feedback
  "haptic", "toast", "snackbar", "playMedia", "stopMedia", "speak", "confetti",
  // system / share / clipboard
  "share", "shareFile", "copyToClipboard", "readClipboard",
  "sms", "email", "phone", "download", "saveToPhotos",
  // media pickers
  "pickImage", "pickDocument", "scanQR",
  // permissions
  "requestPermission",
  // auth
  "biometricPrompt", "signOut",
  // app-level chrome — swap the alternate app icon at runtime
  "setAppIcon",
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
  // keyboard bridge
  "keyboard.reload", "keyboard.setLayout",
  // mic handoff — main app records + refines, keyboard inserts (see
  // targets/keyboard/TulmiHandoff.swift and modules/tulmi-bridge).
  "completeKeyboardHandoff", "cancelKeyboardHandoff", "armFlowSession",
  // cache / dev
  "clearCache", "reloadApp",
  // composition
  "sequence", "parallel", "condition", "delay", "log",
] as const;

/** Named layouts the app can compose from `template` + `blocks`. */
export const CORE_TEMPLATES = [
  "scroll", "feature", "list", "centered", "detail", "grid", "hero",
] as const;
