Pod::Spec.new do |s|
  s.name           = 'TulmiBridge'
  s.version        = '1.0.0'
  s.summary        = 'Shares the backend URL + auth token with the Tulmi keyboard extension.'
  s.description    = 'Writes the app backend URL + user token into the shared App Group for the keyboard.'
  s.author         = ''
  s.homepage       = 'https://github.com/CHEDFOX/tulmi'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
