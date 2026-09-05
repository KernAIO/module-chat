---
'@kernhq/module-chat': minor
---

Incoming webhooks are gone: the `chat.webhooks.incoming` procedure, the `POST
/api/chat/webhooks/{token}` route and the `mod_chat.webhooks` table. Nothing could ever create a
token — the only thing that ever named a `chat.webhooks.create` procedure was the comment above the
table, written in the commit that added it — so there was no procedure, no insert and no screen, and
the endpoint could only ever answer 404 against a permanently empty table. It was a feature nobody
could turn on, advertised in the module's OpenAPI document (38 paths before, 37 after). Dropping the
table loses no data on any instance, and `0001_drop_webhooks.sql` is guarded with `if exists` so the
folder still survives a replay. Incoming webhooks can come back as a real feature — create, list and
revoke, with a screen to manage the tokens.
