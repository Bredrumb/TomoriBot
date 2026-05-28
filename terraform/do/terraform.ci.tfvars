# CI overrides for terraform-do (safe to commit — no secrets here).
# Sensitive values (tokens, CIDRs) are passed via TF_VAR_* environment variables
# set from GitHub Secrets in the deploy-matrix-infra workflow.

cloudflare_account_id = "38ac8af234ede45af190cc2b86ab688b"
cloudflare_zone_id    = "c0ebd18d8032f01f630b553c8f368357"
cloudflare_zone_name  = "tomoribot.app"
matrix_tunnel_id      = "e4598184-3126-4d41-8a18-61e393cbfb30"
