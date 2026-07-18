# Values injected by CI via environment variables:
#   TF_VAR_azure_subscription_id      = ${{ secrets.AZURE_SUBSCRIPTION_ID }}
#   TF_VAR_postgres_admin_password    = ${{ secrets.AZURE_POSTGRES_ADMIN_PASSWORD }}
#   TF_VAR_vm_admin_ssh_public_key    = <public half of the Phase 0 deploy keypair>
#
# Non-sensitive CI overrides:
environment = "production"

# Optional admin database access. Leave null in CI unless temporarily opening a
# single operator IP for restore/debug access.
admin_ip = null
