/**
 * Cloudflare WAF custom ruleset for Matrix appservice callback protection.
 *
 * Rule logic:
 *   Block requests to /_matrix/app/ on the appservice callback host where
 *   the source IP is NOT the Matrix homeserver droplet (IPv4 or IPv6).
 *   This matches the rule originally created manually and is intentionally
 *   path-scoped to the Matrix appservice path prefix.
 *
 * Note: The ruleset name must stay "default" — that is Cloudflare's internal
 * name for the zone-level custom rules phase ruleset. Changing it forces
 * destruction and recreation of the entire ruleset.
 */

resource "cloudflare_ruleset" "matrix_waf" {
  zone_id     = var.cloudflare_zone_id
  name        = "default"
  description = "Block non-homeserver traffic to the Matrix appservice callback"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules = [
    # Block non-homeserver IPs hitting the Matrix appservice path.
    # Both IPv4 and IPv6 addresses of the droplet are allowed through.
    {
      description = "block-non-do-matrix-appservice"
      expression  = "(http.host eq \"matrix-appservice.${var.cloudflare_zone_name}\" and starts_with(http.request.uri.path, \"/_matrix/app/\") and not ip.src in {${digitalocean_droplet.matrix_homeserver.ipv4_address} ${digitalocean_droplet.matrix_homeserver.ipv6_address}})"
      action      = "block"
      enabled     = true
    },
  ]
}
