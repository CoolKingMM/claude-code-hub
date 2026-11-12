ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "fake_streaming_provider_ids" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_provider_output_safety_filter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "provider_output_safety_filter_rules" jsonb;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "enable_codex_history_filter" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "codex_history_filter_provider_ids" jsonb;
