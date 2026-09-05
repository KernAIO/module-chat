---
'@kernhq/module-chat': patch
---

The composer's voice and video buttons say why they cannot record. They were disabled whenever the
browser has no `MediaRecorder` — which is also every instance served over plain HTTP, where
`navigator.mediaDevices` is absent — and a disabled button explains nothing to a pointer, a keyboard
or a screen reader. Pressing one now opens the recorder bar on its "this browser cannot record"
message, which was written and translated but could never be reached.
