---
'@kernhq/module-chat': patch
---

Peer and develop against `@kernhq/kernel` ^0.10.0. A caret on 0.x does not cross a minor, so the
previous `^0.9.1` could no longer reach the published framework — invisible locally, where the
workspace copy is linked, and a lint failure in CI, which installs from the registry.
