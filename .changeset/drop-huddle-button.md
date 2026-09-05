---
'@kernhq/module-chat': patch
---

The conversation header no longer carries a Huddle button. Calls are not built, so the button was
permanently disabled on the busiest screen in the product — in every channel and every direct
message, for everybody — and its only explanation was a `title` on a natively disabled button,
which nothing can reach: a disabled button is out of the tab order and receives no pointer events,
so neither a keyboard nor a screen reader nor a hover ever got the reason. It comes back when calls
do.
