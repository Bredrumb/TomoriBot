# Terraform: DigitalOcean Matrix Homeserver

This stack provisions a low-cost Matrix homeserver base on DigitalOcean:

- Droplet (`tuwunel`/Conduit host)
- Persistent volume for Matrix data
- Firewall (SSH + `80` + `443` + `8448`)
- Optional DNS A record (when zone is managed by DigitalOcean)

It is intentionally isolated from `terraform/` (AWS state) to reduce blast radius.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and set real values.
   - `ssh_ingress_cidrs` is required and must be trusted CIDRs only (no `0.0.0.0/0`).
2. Initialize and apply:

```bash
terraform init
terraform plan
terraform apply
```

## After Provisioning

1. Configure `conduit.toml` / `tuwunel`:
   - `server_name` = your real homeserver domain
   - `allow_registration = false`
   - `allow_federation = true`
2. Mount and use the attached volume for `/var/lib/tuwunel`.
3. Configure reverse proxy/TLS for client+federation traffic.
4. Point appservice URL to TomoriBot callback endpoint:
   - set `MATRIX_APPSERVICE_PUBLIC_URL` in TomoriBot secrets/env
   - use the same value in homeserver appservice config.
5. Keep bridge rooms non-E2EE (TomoriBot link command rejects encrypted rooms).

### Recommended Caddy TLS config

Use Caddy on the droplet to terminate TLS for both client (`443`) and federation (`8448`) traffic, proxying to tuwunel on host port `8008`.

`/etc/caddy/Caddyfile`:

```caddy
matrix.example.com {
	reverse_proxy 127.0.0.1:8008

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
	}
}

https://matrix.example.com:8448 {
	reverse_proxy 127.0.0.1:8008
}
```

Apply and verify:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl restart caddy
curl -sS https://matrix.example.com/_matrix/client/versions
curl -sS https://matrix.example.com:8448/_matrix/federation/v1/version
```

## Notes

- `enable_droplet_backups = true` provides managed droplet backups.
- Add additional offsite backup of Matrix DB/media if you need tighter RPO/RTO.
