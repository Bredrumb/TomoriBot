import { isIP } from "node:net";

const IPV6_HEXTET_COUNT = 8;

function ipv4ToHextetPair(ipv4: string): string {
  const [a = 0, b = 0, c = 0, d = 0] = ipv4.split(".").map((octet) => Number.parseInt(octet, 10));
  return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

function parseIpv6Hextets(address: string): number[] | null {
  const withoutZone = address.trim().toLowerCase().replace(/%.*$/, "");
  if (isIP(withoutZone) !== 6) return null;

  const dottedTail = withoutZone.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  const hexOnly = dottedTail ? `${dottedTail[1]}${ipv4ToHextetPair(dottedTail[2] ?? "")}` : withoutZone;
  const [head = "", tail] = hexOnly.split("::");
  const headParts = head ? head.split(":") : [];
  if (tail === undefined) return headParts.map((part) => Number.parseInt(part, 16));

  const tailParts = tail ? tail.split(":") : [];
  const zeroFill = new Array<string>(IPV6_HEXTET_COUNT - headParts.length - tailParts.length).fill("0");
  return [...headParts, ...zeroFill, ...tailParts].map((part) => Number.parseInt(part, 16));
}

function hextetsToIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Extracts the IPv4 carried by an IPv4-mapped, IPv4-compatible, NAT64 (`64:ff9b::/96`), or 6to4 address.
 *
 * @returns Null when the input is not an IPv6 address with one of those embeddings.
 */
export function getEmbeddedIpv4(address: string): string | null {
  const hextets = parseIpv6Hextets(address);
  if (!hextets) return null;
  const [h0, h1, h2, h3, h4, h5, h6 = 0, h7 = 0] = hextets;

  const firstFiveZero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
  if (firstFiveZero && h5 === 0xffff) return hextetsToIpv4(h6, h7);
  // `::` and `::1` are the IPv6 unspecified and loopback addresses, not IPv4-compatible ones (RFC 4291).
  if (firstFiveZero && h5 === 0 && (h6 !== 0 || h7 > 1)) return hextetsToIpv4(h6, h7);
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return hextetsToIpv4(h6, h7);
  if (h0 === 0x2002) return hextetsToIpv4(h1 ?? 0, h2 ?? 0);

  return null;
}
