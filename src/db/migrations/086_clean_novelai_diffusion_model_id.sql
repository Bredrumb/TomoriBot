-- Migration 086: Clean up NovelAI diffusion model references from standard image slots.
--
-- Server model configs and saved provider configs could have stored NovelAI diffusion model
-- IDs in the standard diffusion_model_id column. Move them to nai_diffusion_model_id if empty,
-- and set diffusion_model_id to NULL.

-- 1. If server_novelai_imagegen_configs has no nai_diffusion_model_id, but server_model_configs has a NovelAI model, migrate it.
UPDATE server_novelai_imagegen_configs snc
SET nai_diffusion_model_id = smc.diffusion_model_id
FROM server_model_configs smc
JOIN image_diffusion_models idm ON idm.diffusion_model_id = smc.diffusion_model_id
WHERE snc.server_id = smc.server_id
  AND idm.provider = 'novelai'
  AND snc.nai_diffusion_model_id IS NULL;

-- 2. Clear NovelAI diffusion model references from server_model_configs.diffusion_model_id.
UPDATE server_model_configs smc
SET diffusion_model_id = NULL
FROM image_diffusion_models idm
WHERE smc.diffusion_model_id = idm.diffusion_model_id
  AND idm.provider = 'novelai';

-- 3. Clear NovelAI diffusion model references from saved_provider_configs.diffusion_model_id.
UPDATE saved_provider_configs
SET nai_diffusion_model_id = COALESCE(nai_diffusion_model_id, diffusion_model_id),
    diffusion_model_id = NULL
WHERE provider = 'novelai'
  AND diffusion_model_id IS NOT NULL;

-- 4. Clear NovelAI diffusion model references from user_saved_provider_configs.diffusion_model_id.
UPDATE user_saved_provider_configs
SET nai_diffusion_model_id = COALESCE(nai_diffusion_model_id, diffusion_model_id),
    diffusion_model_id = NULL
WHERE provider = 'novelai'
  AND diffusion_model_id IS NOT NULL;
