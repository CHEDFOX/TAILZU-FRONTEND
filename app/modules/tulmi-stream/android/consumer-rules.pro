# WHAT R8 MAY NOT RENAME OR DROP for this module (expo.modules.tulmistream).
#
# The live call's software echo canceller is set through react-native-webrtc's
# own options object BY NAME (CallAec.kt, at the start of the app), so
# nothing in the code refers to that class and R8 is free to rename or remove it
# — in release builds only, silently leaving every phone on its own canceller.
# The library keeps `org.webrtc.**` itself; `com.oney.**` is ours to keep.
#
# Minifying is off in this app today, so these rules are insurance against the
# day it is turned on.
-keep class com.oney.WebRTCModule.WebRTCModuleOptions { public *; }
-dontwarn com.oney.WebRTCModule.**
