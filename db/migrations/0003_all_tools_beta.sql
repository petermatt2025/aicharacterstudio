-- Phase 3/4 tools are implemented: move them from roadmap to beta (allowlisted users + admins).
-- Only rows still in their seeded 'planned' state change, so admin edits are preserved.
UPDATE features SET release_state = 'beta', updated_at = now()
 WHERE key IN ('character_interactions','testimonial_layouts','influencer_campaigns','before_after','ad_variations','fashion_model',
               'product_lifestyle','digital_mockups','product_demonstrator','brand_mascots','marketplace_images','storyboards',
               'video_prep','image_to_prompt','restore_enhance','scene_recreation','batch_campaigns')
   AND release_state = 'planned';
