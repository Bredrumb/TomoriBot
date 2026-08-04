# Values injected by CI via environment variables:
#   TF_VAR_azure_subscription_id      = ${{ secrets.AZURE_SUBSCRIPTION_ID }}
#   TF_VAR_postgres_admin_password    = ${{ secrets.AZURE_POSTGRES_ADMIN_PASSWORD }}
#   TF_VAR_vm_admin_ssh_public_key    = <public half of the Phase 0 deploy keypair>
#
# Non-sensitive CI overrides:
environment = "production"

# Existing production DCRs. These definitions remain external to Terraform;
# this stack owns only their associations to the singleton VM.
vm_insights_data_collection_rule_id      = "/subscriptions/0264170d-06fd-47eb-87ec-2a1c385da660/resourceGroups/tomoribot-rg/providers/Microsoft.Insights/dataCollectionRules/msvmi-japanwest-tomoribot-vm"
application_logs_data_collection_rule_id = "/subscriptions/0264170d-06fd-47eb-87ec-2a1c385da660/resourceGroups/tomoribot-rg/providers/Microsoft.Insights/dataCollectionRules/tomoribot-application-logs"

# grafana_egress_ip is injected by CI through TF_VAR_grafana_egress_ip from the
# protected production environment variable GRAFANA_EGRESS_IP. It creates one
# exact-address firewall rule for the operator's read-only Grafana datasource.
