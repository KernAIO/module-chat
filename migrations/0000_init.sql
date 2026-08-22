CREATE SCHEMA IF NOT EXISTS "mod_chat";
--> statement-breakpoint
CREATE TABLE "mod_chat"."bookmarks" (
	"user_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_message_id_pk" PRIMARY KEY("user_id","message_id")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."channel_members" (
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_message_id" uuid,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"notify_level" text DEFAULT 'mentions' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."channel_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"slug" text,
	"topic" text,
	"purpose" text,
	"object_module" text,
	"object_type" text,
	"object_id" uuid,
	"dm_key" text,
	"auto_join" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"member_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."favorites" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."message_reactions" (
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" text DEFAULT 'user' NOT NULL,
	"thread_root_id" uuid,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"mentions" jsonb DEFAULT '{"users":[],"groups":[],"channel":false}'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"last_reply_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body_text, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."pins" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pinned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."section_channels" (
	"section_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "section_channels_section_id_channel_id_pk" PRIMARY KEY("section_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."thread_participants" (
	"thread_root_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_reply_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_participants_thread_root_id_user_id_pk" PRIMARY KEY("thread_root_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mod_chat"."webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "bookmarks_ws_user_idx" ON "mod_chat"."bookmarks" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_members_ws_user_idx" ON "mod_chat"."channel_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "channel_sections_ws_user_idx" ON "mod_chat"."channel_sections" USING btree ("workspace_id","user_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_ws_slug_uq" ON "mod_chat"."channels" USING btree ("workspace_id","slug") WHERE slug is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_ws_dmkey_uq" ON "mod_chat"."channels" USING btree ("workspace_id","dm_key") WHERE dm_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_ws_object_uq" ON "mod_chat"."channels" USING btree ("workspace_id","object_module","object_type","object_id") WHERE object_id is not null;--> statement-breakpoint
CREATE INDEX "channels_ws_type_idx" ON "mod_chat"."channels" USING btree ("workspace_id","type","archived_at");--> statement-breakpoint
CREATE INDEX "favorites_ws_user_idx" ON "mod_chat"."favorites" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_channel_seq_uq" ON "mod_chat"."messages" USING btree ("channel_id","seq" desc);--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "mod_chat"."messages" USING btree ("thread_root_id","seq") WHERE thread_root_id is not null;--> statement-breakpoint
CREATE INDEX "messages_ws_created_idx" ON "mod_chat"."messages" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_channel_pinned_idx" ON "mod_chat"."messages" USING btree ("channel_id") WHERE pinned;--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "mod_chat"."messages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "pins_channel_idx" ON "mod_chat"."pins" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "section_channels_user_channel_uq" ON "mod_chat"."section_channels" USING btree ("user_id","channel_id");--> statement-breakpoint
CREATE INDEX "thread_participants_ws_user_idx" ON "mod_chat"."thread_participants" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_token_uq" ON "mod_chat"."webhooks" USING btree ("token_hash");
--> statement-breakpoint
-- Row-level security: every tenant table is isolated by workspace_id. The chat service sets
-- `app.workspace_id` per transaction; the sentinel '*' allows service-internal cross-workspace
-- queries (gateway access checks, per-user badge totals) — see src/server/services/db.ts.
--> statement-breakpoint
ALTER TABLE "mod_chat"."channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "channels_ws_isolation" ON "mod_chat"."channels"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."channel_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."channel_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "channel_members_ws_isolation" ON "mod_chat"."channel_members"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."channel_sections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."channel_sections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "channel_sections_ws_isolation" ON "mod_chat"."channel_sections"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."section_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."section_channels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "section_channels_ws_isolation" ON "mod_chat"."section_channels"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."favorites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."favorites" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "favorites_ws_isolation" ON "mod_chat"."favorites"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "messages_ws_isolation" ON "mod_chat"."messages"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."message_reactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."message_reactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "message_reactions_ws_isolation" ON "mod_chat"."message_reactions"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."thread_participants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."thread_participants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "thread_participants_ws_isolation" ON "mod_chat"."thread_participants"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."pins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."pins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pins_ws_isolation" ON "mod_chat"."pins"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."bookmarks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."bookmarks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "bookmarks_ws_isolation" ON "mod_chat"."bookmarks"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "mod_chat"."webhooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mod_chat"."webhooks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "webhooks_ws_isolation" ON "mod_chat"."webhooks"
  USING (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true))
  WITH CHECK (current_setting('app.workspace_id', true) = '*' OR workspace_id::text = current_setting('app.workspace_id', true));
