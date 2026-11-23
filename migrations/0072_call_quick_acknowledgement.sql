-- AI Calling: "Quick acknowledgement before answers" switch (a short "Okay…" while the answer is prepared), off by default.
ALTER TABLE "ai_calling_settings" ADD COLUMN IF NOT EXISTS "quick_acknowledgement" boolean DEFAULT false NOT NULL;
