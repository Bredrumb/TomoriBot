import { isIP } from "node:net";
import { getEmbeddedIpv4 } from "@/utils/security/embeddedIpv4";

// Unconditional SSRF floor never relaxed by private network opt-ins; caller must DNS-resolve first because any non-IP
// hostname returns false.
export function isCloudMetadataAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const family = isIP(normalized);

  // Block link-local 169.254.0.0/16 and Alibaba IMDS 100.100.100.200 only, because the rest of CGNAT 100.64.0.0/10
  // is used by overlay networks like Tailscale.
  if (family === 4) {
    return normalized.startsWith("169.254.") || normalized === "100.100.100.200";
  }

  // IPv6 link-local (fe80::/10), the AWS IPv6 IMDS address (fd00:ec2::254), and GCP's IPv6 metadata server
  // (fd20:ce::254).
  if (family === 6) {
    const embeddedIpv4 = getEmbeddedIpv4(normalized);
    if (embeddedIpv4) return isCloudMetadataAddress(embeddedIpv4);
    return /^fe[89ab]/.test(normalized) || normalized === "fd00:ec2::254" || normalized === "fd20:ce::254";
  }

  return false;
}
