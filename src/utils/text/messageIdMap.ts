// Opaque keys replace raw Discord snowflake IDs so the LLM never sees numeric IDs it could regurgitate or mangle.

type OpaquePrefix = "media" | "ref";

const OPAQUE_KEY_PATTERN = /^(media|ref)_\d+$/;

export class MessageIdMap {
  private counters: Record<OpaquePrefix, number> = { media: 0, ref: 0 };

  private opaqueToReal = new Map<string, string>();

  private realToOpaque = new Map<string, string>();

  register(realId: string, prefix: OpaquePrefix): string {
    const compositeKey = `${prefix}:${realId}`;
    const existing = this.realToOpaque.get(compositeKey);
    if (existing) return existing;

    this.counters[prefix]++;
    const opaqueKey = `${prefix}_${this.counters[prefix]}`;

    this.opaqueToReal.set(opaqueKey, realId);
    this.realToOpaque.set(compositeKey, opaqueKey);

    return opaqueKey;
  }

  resolve(opaqueKey: string): string | undefined {
    return this.opaqueToReal.get(opaqueKey);
  }

  getOpaque(realId: string, prefix: OpaquePrefix): string | undefined {
    return this.realToOpaque.get(`${prefix}:${realId}`);
  }

  static isOpaqueKey(value: string): boolean {
    return OPAQUE_KEY_PATTERN.test(value);
  }
}
