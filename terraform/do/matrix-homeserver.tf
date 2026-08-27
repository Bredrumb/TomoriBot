/**
 * Matrix homeserver resources (droplet, storage, firewall, optional DNS).
 */

locals {
  matrix_fqdn = var.domain_name == null ? null : "${var.matrix_record_name}.${var.domain_name}"
}

resource "digitalocean_droplet" "matrix_homeserver" {
  name     = var.droplet_name
  region   = var.region
  size     = var.droplet_size
  image    = var.droplet_image
  backups  = var.enable_droplet_backups
  ipv6     = true
  tags     = var.tags
  ssh_keys = var.ssh_key_fingerprints

  monitoring = true

  user_data = <<-EOT
	#!/usr/bin/env bash
	set -euxo pipefail
	apt-get update
	apt-get install -y docker.io docker-compose caddy
	systemctl enable --now docker
	mkdir -p /opt/matrix-conduit
  EOT

  # These fields are set at creation time only. Ignore changes to prevent
  # Terraform from destroying and recreating the droplet after initial boot:
  # - user_data: bootstrap script, runs once on first boot only
  # - ssh_keys:  managed via DO dashboard after provisioning
  # - size:      actual droplet size may differ from variable default
  # - backups:   backup setting may differ from variable default
  lifecycle {
    ignore_changes = [user_data, ssh_keys, size, backups]
  }
}

resource "digitalocean_volume" "matrix_data" {
  region                  = var.region
  name                    = var.volume_name
  size                    = var.volume_size_gib
  initial_filesystem_type = "ext4"
  description             = "Persistent Matrix data for TomoriBot bridge homeserver"
}

resource "digitalocean_volume_attachment" "matrix_data" {
  droplet_id = digitalocean_droplet.matrix_homeserver.id
  volume_id  = digitalocean_volume.matrix_data.id
}

resource "digitalocean_firewall" "matrix_homeserver" {
  name        = "${var.droplet_name}-fw"
  droplet_ids = [digitalocean_droplet.matrix_homeserver.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.ssh_ingress_cidrs
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "8448"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_record" "matrix_a" {
  count = var.domain_name == null ? 0 : 1

  domain = var.domain_name
  type   = "A"
  name   = var.matrix_record_name
  value  = digitalocean_droplet.matrix_homeserver.ipv4_address
  ttl    = 300
}

resource "digitalocean_project" "matrix" {
  name        = var.project_name
  description = "TomoriBot Matrix homeserver resources"
  purpose     = "Service or API"
  environment = "Production"
  resources = [
    digitalocean_droplet.matrix_homeserver.urn,
    digitalocean_volume.matrix_data.urn,
  ]
}
