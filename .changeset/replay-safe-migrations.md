---
'@kernhq/module-chat': patch
---

The migration folder survives being applied twice. `0000_init.sql` created every table, index and
policy without a guard, so a replay — which drizzle performs the moment any file in the folder is
edited — threw on the first table and stopped the `chat` service, and the realtime gateway with
it, from starting. Three tests now guard the module: the folder applied twice to a database created
from nothing, a cross-tenant probe under a role that cannot bypass row-level security, and the
permission matrix blessed in full.
