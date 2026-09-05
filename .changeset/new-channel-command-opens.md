---
'@kernhq/module-chat': patch
---

The command palette's "New channel" opens the dialog. It runs `/chat?new=1`, because a command can
only navigate — and nothing read that parameter, so the command moved you to the chat page and
stopped there. The sidebar consumes it now and puts the URL back without it, so running the command
again after closing the dialog opens it again.
