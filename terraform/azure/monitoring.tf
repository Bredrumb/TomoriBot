/**
 * Azure Monitor collection and curated metric alerts for the singleton
 * TomoriBot VM.
 *
 * The Azure Monitor Agent and DCR associations are deliberately managed with
 * the VM. Azure deletes both child resources when Terraform replaces the VM,
 * even if the replacement keeps the same Azure resource ID. Keeping them in
 * the same state ensures guest memory and application cache telemetry resume
 * automatically after replacement.
 *
 * The workspace, custom tables, DCE, and DCR definitions predate this
 * Terraform stack and remain externally managed. Their existing resource IDs
 * are supplied as variables so adopting the VM attachments cannot rewrite
 * ingestion schemas or transforms.
 *
 * Replaces the VM Insights "recommended alerts" bundle (7 rules) that was
 * auto-provisioned outside Terraform. Those defaults were unsuited to a 1 GiB
 * burstable host: Network In/Out Total (500 GB / 200 GB per 5-min window) and
 * Data Disk IOPS (no data disk exists on this VM) could never fire, while
 * Available Memory < 1 GB fired permanently on a VM whose total RAM ~= the
 * threshold. That set produced alert fatigue and false confidence at once.
 *
 * We keep only the three alerts that map to real failure modes of this bot:
 *   1. VM Availability   - the host is down, so the bot is offline.
 *   2. Percentage CPU    - sustained high CPU on a burstable VM signals
 *                          burst-credit exhaustion / throttling.
 *   3. Available Memory  - OOM pressure; threshold tuned to ~100 MiB for the
 *                          1 GiB host (the bot's 1536 MB container cap leans on
 *                          swap, so low available memory is the real risk).
 *
 * These reuse the existing VM Insights action group (email notifications),
 * referenced as a data source because it is not managed here.
 *
 * ADOPTION: the live rules already existed (created by VM Insights, then pruned
 * and re-thresholded via `az`), so a plain apply would fail with "resource
 * already exists". The `import` blocks below let the pipeline adopt them into
 * state during `terraform plan`/`apply` — no out-of-band `terraform import`
 * step. The metric-alert resource ID is built from the managed resource group
 * (`.../resourceGroups/tomoribot-rg/providers/Microsoft.Insights/metricAlerts/<name>`)
 * so the subscription ID stays out of source control.
 *
 * Once the first apply has imported all three into state, these `import` blocks
 * become no-ops (Terraform skips resources already in state) and may be removed
 * on a later cleanup pass; leaving them is harmless and keeps re-runs robust.
 */

locals {
  azure_monitor_data_collection_rules = {
    application-logs = var.application_logs_data_collection_rule_id
    vm-insights      = var.vm_insights_data_collection_rule_id
  }
}

resource "azurerm_virtual_machine_extension" "azure_monitor_linux_agent" {
  name                       = "AzureMonitorLinuxAgent"
  virtual_machine_id         = azurerm_linux_virtual_machine.tomoribot.id
  publisher                  = "Microsoft.Azure.Monitor"
  type                       = "AzureMonitorLinuxAgent"
  type_handler_version       = "1.0"
  auto_upgrade_minor_version = true
  automatic_upgrade_enabled  = true
  tags                       = local.common_tags

  # Associations can exist before AMA is installed. Creating them first avoids
  # AMA caching an initial "VM is not associated with a DCR" response while a
  # replacement VM's dependency graph is still being applied.
  depends_on = [azurerm_monitor_data_collection_rule_association.tomoribot]
}

resource "azurerm_monitor_data_collection_rule_association" "tomoribot" {
  for_each = local.azure_monitor_data_collection_rules

  name                    = "tomoribot-${each.key}"
  target_resource_id      = azurerm_linux_virtual_machine.tomoribot.id
  data_collection_rule_id = each.value
  description             = "TomoriBot ${each.key} telemetry collection."
}

# Existing VM Insights action group (email notifications); not managed here.
data "azurerm_monitor_action_group" "vmi" {
  name                = "VMI-ActionGroup-tomoribot-vm"
  resource_group_name = azurerm_resource_group.main.name
}

import {
  to = azurerm_monitor_metric_alert.vm_availability
  id = "${azurerm_resource_group.main.id}/providers/Microsoft.Insights/metricAlerts/VM Availability - tomoribot-vm"
}

import {
  to = azurerm_monitor_metric_alert.vm_cpu
  id = "${azurerm_resource_group.main.id}/providers/Microsoft.Insights/metricAlerts/Percentage CPU - tomoribot-vm"
}

import {
  to = azurerm_monitor_metric_alert.vm_memory
  id = "${azurerm_resource_group.main.id}/providers/Microsoft.Insights/metricAlerts/Available Memory Bytes - tomoribot-vm"
}

# 1. Host availability: fires when the VM platform availability drops below 1
#    (host down => bot offline). Highest-signal alert for a singleton deployment.
resource "azurerm_monitor_metric_alert" "vm_availability" {
  name                = "VM Availability - tomoribot-vm"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_virtual_machine.tomoribot.id]
  description         = "VM platform availability dropped (host down / bot offline)."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "VmAvailabilityMetric"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = data.azurerm_monitor_action_group.vmi.id
  }
}

# 2. CPU saturation: sustained > 80% on a burstable VM indicates burst-credit
#    exhaustion and imminent throttling.
resource "azurerm_monitor_metric_alert" "vm_cpu" {
  name                = "Percentage CPU - tomoribot-vm"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_virtual_machine.tomoribot.id]
  description         = "Sustained high CPU (burst-credit exhaustion on the burstable VM)."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "Percentage CPU"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = data.azurerm_monitor_action_group.vmi.id
  }
}

# 3. Memory pressure: available memory below ~100 MiB on the 1 GiB host signals
#    OOM risk. Starting value; tune against observed steady-state in the
#    Log Analytics workspace once a baseline is established.
resource "azurerm_monitor_metric_alert" "vm_memory" {
  name                = "Available Memory Bytes - tomoribot-vm"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_linux_virtual_machine.tomoribot.id]
  description         = "Available memory below ~100 MiB (OOM pressure on the 1 GiB host)."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.Compute/virtualMachines"
    metric_name      = "Available Memory Bytes"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 104857600 # 100 MiB
  }

  action {
    action_group_id = data.azurerm_monitor_action_group.vmi.id
  }
}
