-- Video call "Thinking sounds" are off by default now. Settings saved so far stored the old default
-- (on) without anyone choosing it (the setting was one day old), so they are switched off too.
UPDATE "avatar_business_settings"
   SET "video_call" = jsonb_set("video_call", '{thinkingSounds}', 'false'::jsonb)
 WHERE "video_call" ? 'thinkingSounds';
