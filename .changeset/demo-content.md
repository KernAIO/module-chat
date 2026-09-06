---
'@kernhq/module-chat': minor
---

Fill a workspace created with example content: five channels beside the two chat already makes, a
conversation in each and a thread in `#engineering`.

Two things this module has that the others do not, and both decide how the seeder is written.
`#general` and `#random` exist before anybody has done anything — chat makes them on
`core.workspace.created` — so a channel is *found or made*, never assumed either way: the two events
arrive on different subjects with no ordering between them. And the "has anybody used this
workspace?" guard counts messages somebody **wrote**, because creating a channel posts a system
message announcing it, and a guard that counted those skipped every seed while reporting success.
