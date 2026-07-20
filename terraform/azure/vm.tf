/**
 * Singleton VM for TomoriBot.
 *
 * The app deploy is intentionally absent here. CI copies the compose file and
 * secrets, then runs docker compose over SSH after Terraform finishes.
 */

resource "azurerm_linux_virtual_machine" "tomoribot" {
  name                  = "${var.name_prefix}-vm"
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  network_interface_ids = [azurerm_network_interface.vm.id]
  size                  = var.vm_size
  admin_username        = var.vm_admin_username

  disable_password_authentication = true
  custom_data = base64encode(templatefile("${path.module}/cloud-init.yaml", {
    admin_username = var.vm_admin_username
  }))

  # Used for keyless Google Workload Identity Federation. Google trusts only
  # this VM resource path and exchanges its short-lived Entra token for the
  # dedicated TomoriBot Vertex service account.
  identity {
    type = "SystemAssigned"
  }

  admin_ssh_key {
    username   = var.vm_admin_username
    public_key = var.vm_admin_ssh_public_key
  }

  os_disk {
    name                 = "${var.name_prefix}-vm-osdisk"
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 64
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  tags = local.common_tags
}
