---
'@kernhq/module-chat': patch
---

Archiving a private channel no longer announces it to the whole workspace. `realtime.change`
publishes on the workspace channel, which every socket subscribes to for every workspace it belongs
to the moment it authenticates — so archiving or restoring a private, object or group channel told
everybody in the workspace that the channel exists and what had just happened to it, whether or not
they may open it. The change now goes to the channel's own members, the same audience a private
channel's creation already used, and `announce.test.ts` asserts the frames.
