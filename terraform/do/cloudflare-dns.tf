/**
 * Cloudflare DNS records for Matrix bridge infrastructure.
 *
 * matrix.<domain>            — A record pointing to the DO droplet (DNS only, not proxied).
 *                              Must be DNS-only so Matrix federation TLS works end-to-end.
 * matrix-appservice.<domain> — CNAME pointing to the Cloudflare tunnel (proxied).
 *                              Traffic flows through Cloudflare before reaching the tunnel.
 */

# Homeserver A record — DNS only so federation TLS terminates at the droplet.
resource "cloudflare_dns_record" "matrix_homeserver_a" {
  zone_id = var.cloudflare_zone_id
  name    = "matrix"
  type    = "A"
  content = digitalocean_droplet.matrix_homeserver.ipv4_address
  ttl     = 1       # 1 = Cloudflare automatic TTL
  proxied = false   # Must be false — proxied breaks Matrix federation port 8448
  comment = "Matrix homeserver — managed by Terraform"
}

# Appservice callback CNAME — proxied through Cloudflare via the tunnel.
resource "cloudflare_dns_record" "matrix_appservice_cname" {
  zone_id = var.cloudflare_zone_id
  name    = "matrix-appservice"
  type    = "CNAME"
  content = "${var.matrix_tunnel_id}.cfargotunnel.com"
  ttl     = 1
  proxied = true    # Proxied so Cloudflare can apply WAF rules before the tunnel
  comment = "Matrix appservice callback — managed by Terraform"
}
