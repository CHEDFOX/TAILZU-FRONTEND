Pod::Spec.new do |s|
  s.name           = 'TulmiStream'
  s.version        = '1.0.0'
  s.summary        = 'Live (streaming) dictation for the Tulmi app.'
  s.description    = 'Streams mic PCM to /v1/transcribe-stream over a WebSocket and emits partial/final transcripts.'
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
