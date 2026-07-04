---
title: "Azure VM Deployment"
sidebar:
  order: 4
---

TomoriBot's Azure VM deployment path runs the published bot image with
`deploy/azure/docker-compose.yml`. The compose file is intentionally small: it
does not provision Azure resources, build images, or create secrets. Terraform
and CI provide those pieces.

## Runtime contract

| Item | Value |
|---|---|
| Compose file | `deploy/azure/docker-compose.yml` |
| Service name | `tomoribot` |
| Image input | `TOMORIBOT_IMAGE` |
| Host secret file | `/etc/tomoribot/secrets.json` |
| Container secret file | `/run/secrets/tomoribot.json` |
| Secret env var | `SECRET_FILE=/run/secrets/tomoribot.json` |
| Health check | `curl -f http://localhost:8081/healthz` |

The health port is bound to `127.0.0.1:8081` on the VM. It is for SSH-driven
deploy verification, not public ingress.

## Secret file

The VM secret file uses the same JSON shape as the existing AWS/GCP production
secret blob. `SECRET_FILE` is read first; `GCP_SECRET_FILE` remains as a fallback
for the current Cloud Run deployment.

For Cloudflare R2, include these storage fields in the JSON:

```json
{
  "S3_ENDPOINT": "https://<account_id>.r2.cloudflarestorage.com",
  "AWS_ACCESS_KEY_ID": "<r2-access-key-id>",
  "AWS_SECRET_ACCESS_KEY": "<r2-secret-access-key>",
  "AVATAR_S3_BUCKET": "tomoribot-assets",
  "AVATAR_S3_REGION": "auto",
  "AVATAR_S3_PREFIX": "avatars",
  "AVATAR_PUBLIC_BASE_URL": "https://assets.example.com",
  "VOICE_SAMPLE_S3_BUCKET": "tomoribot-assets",
  "VOICE_SAMPLE_S3_REGION": "auto",
  "VOICE_SAMPLE_S3_PREFIX": "voice-samples",
  "VOICE_SAMPLE_PUBLIC_BASE_URL": "https://assets.example.com",
  "CHARREF_S3_BUCKET": "tomoribot-assets",
  "CHARREF_S3_REGION": "auto",
  "CHARREF_S3_PREFIX": "charreferences",
  "CHARREF_PUBLIC_BASE_URL": "https://assets.example.com"
}
```

The AWS SDK reads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from
`process.env` after TomoriBot loads the JSON. `S3_ENDPOINT` makes the S3 clients
use path-style requests for R2.

## Asset URL rewrite

Before cutover, run a dry-run against the production database:

```sh
bun run scripts/devtools/migrateAssetUrls.ts --from https://old-assets.example.com --to https://assets.example.com --dry-run
```

Remove `--dry-run` to rewrite matching stored prefixes in persona avatars,
persona and preset sprites, shared preset avatars, voice samples, and NovelAI
character reference URLs.

## Optional SearXNG

The compose file includes a `searxng` profile but does not enable it by default.
When enabling it later, set `SEARXNG_IMAGE` to the approved image and expose it
to the bot with `SEARXNG_BASE_URL=http://searxng:8080/`.
