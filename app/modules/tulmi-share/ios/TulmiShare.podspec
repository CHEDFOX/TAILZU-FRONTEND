Pod::Spec.new do |s|
  s.name           = 'TulmiShare'
  s.version        = '1.0.0'
  s.summary        = 'Takes what the Tailzu share extension left in the App Group.'
  s.description    = 'Reads the shared items the share extension wrote to the App Group and moves its files into the app cache.'
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
