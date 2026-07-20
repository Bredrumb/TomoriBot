/**
 * Curated Azure Monitor metric alerts for the singleton TomoriBot VM.
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
 * NOTE: the live rules already existed (created by VM Insights, then pruned and
 * re-thresholded via `az`). Bring them under Terraform with `terraform import`
 * before the next apply so it does not attempt to recreate them:
 *
 *   terraform import 'azurerm_monitor_metric_alert.vm_availability' \
 *     '/subscriptions/0264170d-06fd-47eb-87ec-2a1c385da660/resourceGroups/tomoribot-rg/providers/Microsoft.Insights/metricAlerts/VM Availability - tomoribot-vm'
 *   terraform import 'azurerm_monitor_metric_alert.vm_cpu' \
 *     '/subscriptions/0264170d-06fd-47eb-87ec-2a1c385da660/resourceGroups/tomoribot-rg/providers/Microsoft.Insights/metricAlerts/Percentage CPU - tomoribot-vm'
 *   terraform import 'azurerm_monitor_metric_alert.vm_memory' \
 *     '/subscriptions/0264170d-06fd-47eb-87ec-2a1c385da660/resourceGroups/tomoribot-rg/providers/Microsoft.Insights/metricAlerts/Available Memory Bytes - tomoribot-vm'
 *
 * After import, `terraform plan` should report no changes for these resources.
 */

# Existing VM Insights action group (email notifications); not managed here.
data "azurerm_monitor_action_group" "vmi" {
  name                = "VMI-ActionGroup-tomoribot-vm"
  resource_group_name = azurerm_resource_group.main.name
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
