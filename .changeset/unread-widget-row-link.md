---
'@kernhq/module-chat': patch
---

A row in the unread-chat widget opens its conversation. It linked to `/<ws>/chat?channel=<id>`
while the chat page reads `?c=`, so every row on the dashboard landed on chat with nothing selected
and the "pick a conversation" empty state.
