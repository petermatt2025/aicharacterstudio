-- Phase 2 creator tools are implemented: move them from teaser to beta (allowlisted users + admins).
-- Only rows still in their seeded 'coming_soon' state change, so admin edits are preserved.
UPDATE features SET release_state = 'beta', updated_at = now()
 WHERE key IN ('expressions','outfit_swap','style_transform','poses','headshots','ai_twin','thumbnails','social_content','memes')
   AND release_state = 'coming_soon';
