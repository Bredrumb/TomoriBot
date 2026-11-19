import { isIP } from "node:net";
import { getEmbeddedIpv4 } from "@/utils/security/embeddedIpv4";

// Unconditional SSRF floor never relaxed by private network opt-ins; caller must DNS-resolve first because any non-IP
// hostname returns false.
export function isCloudMetadataAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const family = isIP(normalized);

  // IPv4 link-local (169.254.0.0/16): includes the 169.254.169.254 IMDS
  //    address used by AWS, Azure, and GCP (metadata.google.internal resolves
  //    here). The whole /16 is non-routable and has no fetch use case.
  //    Alibaba Cloud's metadata service is the single address 100.100.100.200;
  //    the rest of 100.64.0.0/10 is carrier-grade NAT that overlay networks such
  //    as Tailscale use legitimately, so only that address is blocked here.
  if (family === 4) {
    return normalized.startsWith("169.254.") || normalized === "100.100.100.200";
  }

  // IPv6 link-local (fe80::/10), the AWS IPv6 IMDS address (fd00:ec2::254), and
  //    GCP's metadata server address for IPv6-only VMs (fd20:ce::254).
  if (family === 6) {
    const embeddedIpv4 = getEmbeddedIpv4(normalized);
    if (embeddedIpv4) return isCloudMetadataAddress(embeddedIpv4);
    return /^fe[89ab]/.test(normalized) || normalized === "fd00:ec2::254" || normalized === "fd20:ce::254";
  }

  return false;
}
