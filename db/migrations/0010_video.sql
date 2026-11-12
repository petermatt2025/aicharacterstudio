-- Photo Animator: generated videos are stored as assets (MP4), with the source photo's thumbnail as poster.
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_mime_check;
ALTER TABLE assets ADD CONSTRAINT assets_mime_check CHECK (mime IN ('image/png','image/jpeg','image/webp','video/mp4'));
