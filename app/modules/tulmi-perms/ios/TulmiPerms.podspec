Pod::Spec.new do |s|
  s.name           = 'TulmiPerms'
  s.version        = '1.0.0'
  s.summary        = 'The phone-side features the app asks the person for: contacts, location, calendar, Reminders, Focus, Motion, arrival reminders and attestation.'
  s.description    = 'Picks one email with the system contact picker (no Contacts key); names where the person is once, returning only the area words; opens the phone\'s own event editor and reads busy times only; keeps one Reminders list; reads what the Focus Filter saw; counts steps and notices walks with Motion & Fitness; arms arrival reminders the system itself watches; and answers Apple\'s App Attest and DeviceCheck for abuse prevention.'
  s.author         = ''
  s.homepage       = 'https://github.com/CHEDFOX/tulmi'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # ContactsUI brings Contacts with it. CNContactStore is never touched, which is why
  # NSContactsUsageDescription is not in the build. CoreLocation is one foreground fix
  # and the OS geocoder, both covered by NSLocationWhenInUseUsageDescription.
  #
  # Build 8.9.1 adds (perms2/SPEC.md 10.2):
  #   EventKit        busy times only, under NSCalendarsFullAccessUsageDescription, and the Reminders list
  #                   under NSRemindersFullAccessUsageDescription
  #   EventKitUI      the phone's own event editor, which on iOS 17+ runs out of process and needs no access
  #   CoreMotion      steps, walks and the "in a car?" check, under NSMotionUsageDescription — calling it
  #                   without that key crashes, which is why abilities() checks for the key first
  #   UserNotifications  arrival reminders the SYSTEM watches, under the While Using location grant
  #   DeviceCheck     App Attest and DeviceCheck, for abuse and fraud prevention only. No entitlement needed
  #                   here; the App Attest environment entitlement is on the app (app.config.ts)
  #   CryptoKit       SHA256 of the server's challenge, and the one-way code the attestation key ids are
  #                   filed under. Nothing is hashed from this phone's own traits (spec 8.2 rule 1)
  #   Security        the Keychain the App Attest key ids are filed in, pinned to the app's OWN access group
  #                   so the keyboard and the widgets cannot read them. Named here rather than left to Swift's
  #                   autolinking, so a missing framework is never a surprise at build time
  #
  # NOT Intents and NOT AppIntents: there is no Focus Status here, and the Focus Filter is an app target's
  # file (targets/widgets/_shared/FocusFilter.swift), not this pod's.
  s.frameworks = 'ContactsUI', 'CoreLocation', 'EventKit', 'EventKitUI', 'CoreMotion', 'UserNotifications',
                 'DeviceCheck', 'CryptoKit', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
