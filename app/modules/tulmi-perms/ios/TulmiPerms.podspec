Pod::Spec.new do |s|
  s.name           = 'TulmiPerms'
  s.version        = '1.0.0'
  s.summary        = 'The system contact picker and one foreground fix named by the OS geocoder.'
  s.description    = 'Picks one email with the system contact picker (no Contacts key), and names where the person is once, returning only the area words.'
  s.author         = ''
  s.homepage       = 'https://github.com/CHEDFOX/tulmi'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # ContactsUI brings Contacts with it. CNContactStore is never touched, which is why
  # NSContactsUsageDescription is not in the build. CoreLocation is one foreground fix
  # and the OS geocoder, both covered by NSLocationWhenInUseUsageDescription.
  s.frameworks = 'ContactsUI', 'CoreLocation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
