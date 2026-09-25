# The widgets

One WidgetKit extension, three things. Everything it shows comes from the
App Group the app writes; nothing here talks to the server, and no dictated
text is ever drawn — a widget sits on a Lock Screen.

- **The Month** (`MonthWidget.swift`) — Home Screen small, and the three Lock
  Screen families. Words left and the month's line for the free plan; words
  this month and a slow line for a subscriber; the streak. The app writes the
  numbers with `setWidgetMonth` every time a bootstrap lands
  (`src/widgets/month.ts`), and the widget is redrawn then.
- **The Flow session** (`FlowActivity.swift`) — a Live Activity while the
  background microphone is armed: ready, listening with the words so far,
  writing. Stop and End buttons post the Darwin notifications the session
  already listens for. The app side is `modules/tulmi-bridge/ios/FlowLiveActivity.swift`,
  driven by `FlowSessionManager`; the attributes struct is declared in both
  and must stay identical.
- **Dictate** (`DictateControl.swift`) — an iOS 18 Control for Control Center,
  the Lock Screen and the Action Button. It opens the app on its arming
  screen, which arms the microphone and says "swipe back": the same path the
  keyboard's mic key takes, one tap earlier.

Type-checked in CI (`keyboard-ios.yml`, job `widgets`). Built by EAS with the
app through `@bacons/apple-targets`.
