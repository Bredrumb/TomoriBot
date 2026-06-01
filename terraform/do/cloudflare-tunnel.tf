/**
 * Cloudflare Tunnel route for the Matrix appservice callback.
 *
 * The tunnel connector runs on the DO droplet and forwards
 * matrix-appservice.<domain> → http://127.0.0.1:<port> inside the droplet.
 *
 * NOTE: This only manages the tunnel *route* (public hostname → service mapping).
 * The tunnel itself and its connector are pre-existing and managed outside Terraform.
 * Importing the existing tunnel as a data source avoids accidental recreation.
 */

data "cloudflare_zero_trust_tunnel_cloudflared" "matrix" {
  account_id = var.cloudflare_account_id
  tunnel_id  = var.matrix_tunnel_id
}

# NOTE: The public hostname route (matrix-appservice.<domain> → http://127.0.0.1:9993)
# is defined in the tunnel connector's config.yml on the droplet, not via Terraform.
# The DNS CNAME record in cloudflare-dns.tf already points the subdomain at the tunnel.
# cloudflare_zero_trust_tunnel_cloudflared_route is for private IP routing only.
