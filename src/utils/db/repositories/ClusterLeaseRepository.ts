import type { SQL } from "bun";
import { sql } from "@/utils/db/client";

export interface LeaseGrant {
  token: string;
}

const QUERY_TIMEOUT_MS = 2_000;

export class ClusterLeaseRepository {
  constructor(private readonly db?: SQL) {}

  async takeIfExpired(name: string, holder: string, ttlMs: number, signal?: AbortSignal): Promise<LeaseGrant | null> {
    this.validate(name, holder, ttlMs);
    const run = this.db ?? sql;
    const rows = await this.execute(
      run<LeaseGrant[]>`
      INSERT INTO cluster_leases AS lease (name, holder, token, expires_at)
      VALUES (${name}, ${holder}, 1, clock_timestamp() + ${ttlMs} * INTERVAL '1 millisecond')
      ON CONFLICT (name) DO UPDATE SET
        holder = EXCLUDED.holder,
        token = lease.token + 1,
        expires_at = clock_timestamp() + ${ttlMs} * INTERVAL '1 millisecond'
      WHERE lease.expires_at <= clock_timestamp()
      RETURNING token::text
    `,
      signal,
    );
    return rows[0] ?? null;
  }

  async renew(
    name: string,
    holder: string,
    token: string,
    ttlMs: number,
    signal?: AbortSignal,
  ): Promise<LeaseGrant | null> {
    this.validate(name, holder, ttlMs);
    const run = this.db ?? sql;
    const rows = await this.execute(
      run<LeaseGrant[]>`
      UPDATE cluster_leases SET expires_at = clock_timestamp() + ${ttlMs} * INTERVAL '1 millisecond'
      WHERE name = ${name} AND holder = ${holder} AND token = ${token}::bigint
        AND expires_at > clock_timestamp()
      RETURNING token::text
    `,
      signal,
    );
    return rows[0] ?? null;
  }

  async release(name: string, holder: string, token: string): Promise<boolean> {
    const run = this.db ?? sql;
    // Retain the row so a later acquisition cannot reuse an old fencing token.
    const rows = await this.execute(run<LeaseGrant[]>`
      UPDATE cluster_leases SET expires_at = '-infinity'::timestamptz
      WHERE name = ${name} AND holder = ${holder} AND token = ${token}::bigint
      RETURNING token::text
    `);
    return rows.length > 0;
  }

  private validate(name: string, holder: string, ttlMs: number): void {
    if (!name || !holder || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Invalid cluster lease request");
    }
  }

  private async execute<T>(query: SQL.Query<T>, signal?: AbortSignal): Promise<T> {
    const deadline = AbortSignal.timeout(QUERY_TIMEOUT_MS);
    const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let cancel: () => void = () => {};
    try {
      cancellation.throwIfAborted();
      return await new Promise<T>((resolve, reject) => {
        cancel = () => {
          // Bun cancellation can leave the query promise pending, so settle the caller independently.
          reject(cancellation.reason);
          query.cancel();
        };
        cancellation.addEventListener("abort", cancel, { once: true });
        query.then(resolve, reject);
      });
    } finally {
      cancellation.removeEventListener("abort", cancel);
    }
  }
}

export const clusterLeaseRepository = new ClusterLeaseRepository();
