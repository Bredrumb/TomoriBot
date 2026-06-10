-- Adds an "identity" flag to persona sprites.
-- An identity sprite renders its decorated "Sprite (Persona)" name directly in
-- Discord (like a DID alter / copied identity), instead of the clean persona
-- name used by ordinary sprites. The model-facing context label is unchanged
-- ("Persona (Sprite):"), so invocation syntax stays identical.

ALTER TABLE persona_sprites
  ADD COLUMN IF NOT EXISTS is_identity BOOLEAN NOT NULL DEFAULT false;
