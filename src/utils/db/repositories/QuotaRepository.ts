/**
 * QuotaRepository: manages all quota tables for text, image, and video generation.
 *
 * Owns tables:
 *   text_quota_configs, text_quotas, text_serverwide_quotas
 *   image_quota_configs, image_quotas, image_serverwide_quotas
 *   video_quota_configs, video_quotas, video_serverwide_quotas
 *
 * This repository is not exportable (quota counters are transient; configs are
 * server-specific operational settings, not portable persona state).
 *
 * Export contract: toExportShape returns null: IRepository is implemented as a
 * no-op stub to satisfy the interface and future pipeline composition.
 */
import type { SQL } from "bun";
import type {
  ImageQuotaConfigRow,
  ImageQuotaRow,
  ServerwideQuotaRow,
  TextQuotaConfigRow,
  TextQuotaRow,
  TextServerwideQuotaRow,
  VideoQuotaConfigRow,
  VideoQuotaRow,
  VideoServerwideQuotaRow,
} from "@/types/db/schema";
import {
  imageQuotaConfigSchema,
  imageQuotaSchema,
  serverwideQuotaSchema,
  textQuotaConfigSchema,
  textQuotaSchema,
  textServerwideQuotaSchema,
  videoQuotaConfigSchema,
  videoQuotaSchema,
  videoServerwideQuotaSchema,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import type {} from "./IRepository";

export type TextQuotaConfigReadResult =
  | { status: "fresh"; config: TextQuotaConfigRow | null }
  | { status: "unavailable"; config: null };

export type ImageQuotaConfigReadResult =
  | { status: "fresh"; config: ImageQuotaConfigRow | null }
  | { status: "unavailable"; config: null };

export type VideoQuotaConfigReadResult =
  | { status: "fresh"; config: VideoQuotaConfigRow | null }
  | { status: "unavailable"; config: null };

export type QuotaReservation = {
  quotaDate: string;
  userCounted: boolean;
  /** Exact text because a JS Date drops the microseconds the release must match. */
  serverwidePeriodStart: string | null;
};

export type QuotaReservationOutcome =
  | {
      status: "reserved";
      reservation: QuotaReservation;
      userRemaining?: number;
      serverwideRemaining?: number;
      serverwidePeriodEnd?: Date;
    }
  | { status: "user_quota_exceeded" }
  | { status: "serverwide_quota_exceeded"; periodEnd: Date };

class QuotaCapReached extends Error {
  constructor(readonly outcome: Exclude<QuotaReservationOutcome, { status: "reserved" }>) {
    super(outcome.status);
  }
}

/**
 * Read-only text quota config query with read provenance.
 * Does not insert default rows and does not fallback to synthetic rows on error.
 */
export async function getTextConfigResult(serverId: number): Promise<TextQuotaConfigReadResult> {
  try {
    const [existing] = await sql<TextQuotaConfigRow[]>`
      SELECT * FROM text_quota_configs WHERE server_id = ${serverId}
    `;
    return {
      status: "fresh",
      config: existing ? textQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getTextConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

/**
 * Read-only image quota config query with read provenance.
 * Does not insert default rows and does not fallback to synthetic rows on error.
 */
export async function getImageConfigResult(serverId: number): Promise<ImageQuotaConfigReadResult> {
  try {
    const [existing] = await sql<ImageQuotaConfigRow[]>`
      SELECT * FROM image_quota_configs WHERE server_id = ${serverId}
    `;
    return {
      status: "fresh",
      config: existing ? imageQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getImageConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

/**
 * Read-only video quota config query with read provenance.
 * Does not insert default rows and does not fallback to synthetic rows on error.
 */
export async function getVideoConfigResult(serverId: number): Promise<VideoQuotaConfigReadResult> {
  try {
    const [existing] = await sql<VideoQuotaConfigRow[]>`
      SELECT * FROM video_quota_configs WHERE server_id = ${serverId}
    `;
    return {
      status: "fresh",
      config: existing ? videoQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getVideoConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

/**
 * Fetch or create the text quota config for a server.
 * Creates a default (disabled, unlimited) row if none exists.
 *
 * @param serverId - Internal server DB ID
 * @returns Parsed TextQuotaConfigRow (safe fallback defaults on error)
 */
export async function getOrCreateTextConfig(serverId: number): Promise<TextQuotaConfigRow> {
  try {
    const [existing] = await sql<TextQuotaConfigRow[]>`
      SELECT * FROM text_quota_configs WHERE server_id = ${serverId}
    `;
    if (existing) return textQuotaConfigSchema.parse(existing);

    const [created] = await sql<TextQuotaConfigRow[]>`
      INSERT INTO text_quota_configs (server_id, daily_user_quota, serverwide_quota, serverwide_quota_resets_in, enabled)
      VALUES (${serverId}, 0, 0, 365, false)
      RETURNING *
    `;
    return textQuotaConfigSchema.parse(created);
  } catch (error) {
    log.error(`QuotaRepository.getOrCreateTextConfig: failed for server ${serverId}`, error);
    return {
      server_id: serverId,
      daily_user_quota: 0,
      serverwide_quota: 0,
      serverwide_quota_resets_in: 365,
      enabled: false,
    };
  }
}

/**
 * Touch (get-or-init) a user's daily text quota record for today.
 * Uses INSERT ON CONFLICT so the row is created on first access each day.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 * @param today      - Date string in YYYY-MM-DD format
 * @returns Parsed TextQuotaRow
 */
export async function touchUserTextQuota(serverId: number, userDiscId: string, today: string): Promise<TextQuotaRow> {
  const [row] = await sql<TextQuotaRow[]>`
    INSERT INTO text_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return textQuotaSchema.parse(row);
}

/**
 * Touch (get-or-init) the server-wide text quota record.
 * Creates the row for a new period if it does not yet exist.
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - Period length in days (from text_quota_configs)
 * @returns Parsed TextServerwideQuotaRow
 */
export async function touchServerwideTextQuota(serverId: number, resetDays: number): Promise<TextServerwideQuotaRow> {
  const [row] = await sql<TextServerwideQuotaRow[]>`
    INSERT INTO text_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    )
    ON CONFLICT (server_id)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return textServerwideQuotaSchema.parse(row);
}

/**
 * Reset the server-wide text quota period (called when the period has expired,
 * or by an admin force-reset).
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - New period length in days
 * @returns Parsed TextServerwideQuotaRow after reset
 */
export async function resetServerwideTextPeriod(serverId: number, resetDays: number): Promise<TextServerwideQuotaRow> {
  const [row] = await sql<TextServerwideQuotaRow[]>`
    UPDATE text_serverwide_quotas
    SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    WHERE server_id = ${serverId}
    RETURNING *
  `;
  return textServerwideQuotaSchema.parse(row);
}

/** Claim one text generation on both counters or neither; database errors propagate so callers refuse. */
export async function reserveTextQuotaUnits(
  serverId: number,
  userDiscId: string,
  config: TextQuotaConfigRow,
): Promise<QuotaReservationOutcome> {
  const quotaDate = new Date().toISOString().split("T")[0];
  try {
    return await sql.begin(async (tx: SQL): Promise<QuotaReservationOutcome> => {
      let userCounted = false;
      let userRemaining: number | undefined;
      if (config.daily_user_quota > 0) {
        const [user] = await tx<{ usage_count: number }[]>`
          INSERT INTO text_quotas (server_id, user_disc_id, usage_count, quota_date)
          VALUES (${serverId}, ${userDiscId}, 1, ${quotaDate}::date)
          ON CONFLICT (server_id, user_disc_id, quota_date)
          DO UPDATE SET usage_count = text_quotas.usage_count + 1
          WHERE text_quotas.usage_count < ${config.daily_user_quota}
          RETURNING usage_count
        `;
        if (!user) throw new QuotaCapReached({ status: "user_quota_exceeded" });
        userCounted = true;
        userRemaining = config.daily_user_quota - user.usage_count;
      }

      let serverwidePeriodStart: string | null = null;
      let serverwideRemaining: number | undefined;
      let serverwidePeriodEnd: Date | undefined;
      if (config.serverwide_quota > 0) {
        const [pool] = await tx<{ period_start: string; quota_period_end: Date; usage_count: number }[]>`
          INSERT INTO text_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
          VALUES (
            ${serverId},
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
          )
          ON CONFLICT (server_id) DO UPDATE SET
            usage_count = CASE WHEN text_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN 1 ELSE text_serverwide_quotas.usage_count + 1 END,
            quota_period_start = CASE WHEN text_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP ELSE text_serverwide_quotas.quota_period_start END,
            quota_period_end = CASE WHEN text_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
              ELSE text_serverwide_quotas.quota_period_end END
          WHERE text_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
            OR text_serverwide_quotas.usage_count < ${config.serverwide_quota}
          RETURNING quota_period_start::text AS period_start, quota_period_end, usage_count
        `;
        if (!pool) {
          const [current] = await tx<{ quota_period_end: Date }[]>`
            SELECT quota_period_end FROM text_serverwide_quotas WHERE server_id = ${serverId}
          `;
          throw new QuotaCapReached({ status: "serverwide_quota_exceeded", periodEnd: current.quota_period_end });
        }
        serverwidePeriodStart = pool.period_start;
        serverwideRemaining = config.serverwide_quota - pool.usage_count;
        serverwidePeriodEnd = pool.quota_period_end;
      }

      return {
        status: "reserved",
        reservation: { quotaDate, userCounted, serverwidePeriodStart },
        ...(userRemaining !== undefined ? { userRemaining } : {}),
        ...(serverwideRemaining !== undefined ? { serverwideRemaining } : {}),
        ...(serverwidePeriodEnd ? { serverwidePeriodEnd } : {}),
      };
    });
  } catch (error) {
    if (error instanceof QuotaCapReached) return error.outcome;
    throw error;
  }
}

/** A failed release leaves the unit counted, which over-counts rather than under-counts. */
export async function releaseTextQuotaUnits(
  serverId: number,
  userDiscId: string,
  reservation: QuotaReservation,
): Promise<void> {
  try {
    await sql.begin(async (tx: SQL) => {
      if (reservation.userCounted) {
        await tx`
          UPDATE text_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId} AND user_disc_id = ${userDiscId}
            AND quota_date = ${reservation.quotaDate}::date
        `;
      }
      if (reservation.serverwidePeriodStart) {
        await tx`
          UPDATE text_serverwide_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId}
            AND quota_period_start = ${reservation.serverwidePeriodStart}::timestamp
        `;
      }
    });
  } catch (error) {
    log.error(`QuotaRepository.releaseTextQuotaUnits: failed for server ${serverId}`, error);
  }
}

/**
 * Update the daily-per-user text quota limit in text_quota_configs.
 * Callers must ensure the config row exists first (call getOrCreateTextConfig).
 *
 * @param serverId - Internal server DB ID
 * @param limit    - New limit (0 = unlimited)
 */
export async function updateTextDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE text_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

/**
 * Update the server-wide text quota limit and, when first enabling it
 * (transitioning from unlimited 0 to a real limit), initialize the quota period row.
 *
 * @param serverId           - Internal server DB ID
 * @param limit              - New serverwide limit (0 = unlimited)
 * @param currentResetDays   - Current reset-days value from text_quota_configs
 * @param previousLimit      - Previous serverwide limit (used to detect 0→N transition)
 */
export async function updateTextServerwideQuota(
  serverId: number,
  limit: number,
  currentResetDays: number,
  previousLimit: number,
): Promise<void> {
  await sql`UPDATE text_quota_configs SET serverwide_quota = ${limit} WHERE server_id = ${serverId}`;
  if (previousLimit === 0 && limit > 0) {
    await sql`
      INSERT INTO text_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
      VALUES (
        ${serverId},
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
      )
      ON CONFLICT (server_id) DO UPDATE SET
        usage_count        = 0,
        quota_period_start = CURRENT_TIMESTAMP,
        quota_period_end   = CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
    `;
  }
}

/**
 * Update the serverwide text quota reset period and adjust the active period end
 * date if a serverwide limit is currently in effect.
 *
 * @param serverId          - Internal server DB ID
 * @param days              - New reset period in days
 * @param serverwideActive  - True when serverwide_quota > 0 (period end needs updating)
 */
export async function updateTextServerwideResetDays(
  serverId: number,
  days: number,
  serverwideActive: boolean,
): Promise<void> {
  await sql`UPDATE text_quota_configs SET serverwide_quota_resets_in = ${days} WHERE server_id = ${serverId}`;
  if (serverwideActive) {
    await sql`
      UPDATE text_serverwide_quotas
      SET quota_period_end = quota_period_start + (${days} || ' days')::interval
      WHERE server_id = ${serverId}
    `;
  }
}

/**
 * Admin reset: zero out a specific user's text quota for today.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 */
export async function resetUserDailyTextQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO text_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

/**
 * Admin reset: reset the server-wide text quota pool, starting a fresh period now.
 * Looks up the configured reset-days value internally.
 *
 * @param serverId - Internal server DB ID
 */
export async function resetServerwideTextQuotaPool(serverId: number): Promise<void> {
  const config = await getOrCreateTextConfig(serverId);
  await sql`
    INSERT INTO text_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
    )
    ON CONFLICT (server_id) DO UPDATE SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
  `;
}

/**
 * Fetch or create the image quota config for a server.
 * Creates a default (disabled, unlimited) row if none exists.
 *
 * @param serverId - Internal server DB ID
 * @returns Parsed ImageQuotaConfigRow (safe fallback defaults on error)
 */
export async function getOrCreateImageConfig(serverId: number): Promise<ImageQuotaConfigRow> {
  try {
    const [existing] = await sql<ImageQuotaConfigRow[]>`
      SELECT * FROM image_quota_configs WHERE server_id = ${serverId}
    `;
    if (existing) return imageQuotaConfigSchema.parse(existing);

    const [created] = await sql<ImageQuotaConfigRow[]>`
      INSERT INTO image_quota_configs (server_id, daily_user_quota, serverwide_quota, serverwide_quota_resets_in, enabled)
      VALUES (${serverId}, 0, 0, 365, false)
      RETURNING *
    `;
    return imageQuotaConfigSchema.parse(created);
  } catch (error) {
    log.error(`QuotaRepository.getOrCreateImageConfig: failed for server ${serverId}`, error);
    return {
      server_id: serverId,
      daily_user_quota: 0,
      serverwide_quota: 0,
      serverwide_quota_resets_in: 365,
      enabled: false,
    };
  }
}

/**
 * Touch (get-or-init) a user's daily image quota record for today.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 * @param today      - Date string in YYYY-MM-DD format
 * @returns Parsed ImageQuotaRow
 */
export async function touchUserImageQuota(serverId: number, userDiscId: string, today: string): Promise<ImageQuotaRow> {
  const [row] = await sql<ImageQuotaRow[]>`
    INSERT INTO image_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return imageQuotaSchema.parse(row);
}

/**
 * Touch (get-or-init) the server-wide image quota record.
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - Period length in days (from image_quota_configs)
 * @returns Parsed ServerwideQuotaRow
 */
export async function touchServerwideImageQuota(serverId: number, resetDays: number): Promise<ServerwideQuotaRow> {
  const [row] = await sql<ServerwideQuotaRow[]>`
    INSERT INTO image_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    )
    ON CONFLICT (server_id)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return serverwideQuotaSchema.parse(row);
}

/**
 * Reset the server-wide image quota period.
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - New period length in days
 * @returns Parsed ServerwideQuotaRow after reset
 */
export async function resetServerwideImagePeriod(serverId: number, resetDays: number): Promise<ServerwideQuotaRow> {
  const [row] = await sql<ServerwideQuotaRow[]>`
    UPDATE image_serverwide_quotas
    SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    WHERE server_id = ${serverId}
    RETURNING *
  `;
  return serverwideQuotaSchema.parse(row);
}

/** Claim one image generation on both counters or neither; database errors propagate so callers refuse. */
export async function reserveImageQuotaUnits(
  serverId: number,
  userDiscId: string,
  config: ImageQuotaConfigRow,
): Promise<QuotaReservationOutcome> {
  const quotaDate = new Date().toISOString().split("T")[0];
  try {
    return await sql.begin(async (tx: SQL): Promise<QuotaReservationOutcome> => {
      let userCounted = false;
      let userRemaining: number | undefined;
      if (config.daily_user_quota > 0) {
        const [user] = await tx<{ usage_count: number }[]>`
          INSERT INTO image_quotas (server_id, user_disc_id, usage_count, quota_date)
          VALUES (${serverId}, ${userDiscId}, 1, ${quotaDate}::date)
          ON CONFLICT (server_id, user_disc_id, quota_date)
          DO UPDATE SET usage_count = image_quotas.usage_count + 1
          WHERE image_quotas.usage_count < ${config.daily_user_quota}
          RETURNING usage_count
        `;
        if (!user) throw new QuotaCapReached({ status: "user_quota_exceeded" });
        userCounted = true;
        userRemaining = config.daily_user_quota - user.usage_count;
      }

      let serverwidePeriodStart: string | null = null;
      let serverwideRemaining: number | undefined;
      let serverwidePeriodEnd: Date | undefined;
      if (config.serverwide_quota > 0) {
        const [pool] = await tx<{ period_start: string; quota_period_end: Date; usage_count: number }[]>`
          INSERT INTO image_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
          VALUES (
            ${serverId},
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
          )
          ON CONFLICT (server_id) DO UPDATE SET
            usage_count = CASE WHEN image_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN 1 ELSE image_serverwide_quotas.usage_count + 1 END,
            quota_period_start = CASE WHEN image_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP ELSE image_serverwide_quotas.quota_period_start END,
            quota_period_end = CASE WHEN image_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
              ELSE image_serverwide_quotas.quota_period_end END
          WHERE image_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
            OR image_serverwide_quotas.usage_count < ${config.serverwide_quota}
          RETURNING quota_period_start::text AS period_start, quota_period_end, usage_count
        `;
        if (!pool) {
          const [current] = await tx<{ quota_period_end: Date }[]>`
            SELECT quota_period_end FROM image_serverwide_quotas WHERE server_id = ${serverId}
          `;
          throw new QuotaCapReached({ status: "serverwide_quota_exceeded", periodEnd: current.quota_period_end });
        }
        serverwidePeriodStart = pool.period_start;
        serverwideRemaining = config.serverwide_quota - pool.usage_count;
        serverwidePeriodEnd = pool.quota_period_end;
      }

      return {
        status: "reserved",
        reservation: { quotaDate, userCounted, serverwidePeriodStart },
        ...(userRemaining !== undefined ? { userRemaining } : {}),
        ...(serverwideRemaining !== undefined ? { serverwideRemaining } : {}),
        ...(serverwidePeriodEnd ? { serverwidePeriodEnd } : {}),
      };
    });
  } catch (error) {
    if (error instanceof QuotaCapReached) return error.outcome;
    throw error;
  }
}

/** A failed release leaves the unit counted, which over-counts rather than under-counts. */
export async function releaseImageQuotaUnits(
  serverId: number,
  userDiscId: string,
  reservation: QuotaReservation,
): Promise<void> {
  try {
    await sql.begin(async (tx: SQL) => {
      if (reservation.userCounted) {
        await tx`
          UPDATE image_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId} AND user_disc_id = ${userDiscId}
            AND quota_date = ${reservation.quotaDate}::date
        `;
      }
      if (reservation.serverwidePeriodStart) {
        await tx`
          UPDATE image_serverwide_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId}
            AND quota_period_start = ${reservation.serverwidePeriodStart}::timestamp
        `;
      }
    });
  } catch (error) {
    log.error(`QuotaRepository.releaseImageQuotaUnits: failed for server ${serverId}`, error);
  }
}

/**
 *
 * @param serverId - Internal server DB ID
 * @param limit    - New limit (0 = unlimited)
 */
export async function updateImageDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE image_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

/**
 * Update the server-wide image quota limit, initializing the period row when
 * first enabling it (0 → N transition).
 *
 * @param serverId           - Internal server DB ID
 * @param limit              - New serverwide limit (0 = unlimited)
 * @param currentResetDays   - Current reset-days value from image_quota_configs
 * @param previousLimit      - Previous serverwide limit
 */
export async function updateImageServerwideQuota(
  serverId: number,
  limit: number,
  currentResetDays: number,
  previousLimit: number,
): Promise<void> {
  await sql`UPDATE image_quota_configs SET serverwide_quota = ${limit} WHERE server_id = ${serverId}`;
  if (previousLimit === 0 && limit > 0) {
    await sql`
      INSERT INTO image_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
      VALUES (
        ${serverId},
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
      )
      ON CONFLICT (server_id) DO UPDATE SET
        usage_count        = 0,
        quota_period_start = CURRENT_TIMESTAMP,
        quota_period_end   = CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
    `;
  }
}

/**
 * Update the serverwide image quota reset period.
 *
 * @param serverId         - Internal server DB ID
 * @param days             - New reset period in days
 * @param serverwideActive - True when serverwide_quota > 0
 */
export async function updateImageServerwideResetDays(
  serverId: number,
  days: number,
  serverwideActive: boolean,
): Promise<void> {
  await sql`UPDATE image_quota_configs SET serverwide_quota_resets_in = ${days} WHERE server_id = ${serverId}`;
  if (serverwideActive) {
    await sql`
      UPDATE image_serverwide_quotas
      SET quota_period_end = quota_period_start + (${days} || ' days')::interval
      WHERE server_id = ${serverId}
    `;
  }
}

/**
 * Admin reset: zero out a specific user's image quota for today.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 */
export async function resetUserDailyImageQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO image_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

/**
 * Admin reset: reset the server-wide image quota pool.
 *
 * @param serverId - Internal server DB ID
 */
export async function resetServerwideImageQuotaPool(serverId: number): Promise<void> {
  const config = await getOrCreateImageConfig(serverId);
  await sql`
    INSERT INTO image_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
    )
    ON CONFLICT (server_id) DO UPDATE SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
  `;
}

/**
 * Fetch or create the video quota config for a server.
 * Creates a default (disabled, unlimited) row if none exists.
 *
 * @param serverId - Internal server DB ID
 * @returns Parsed VideoQuotaConfigRow (safe fallback defaults on error)
 */
export async function getOrCreateVideoConfig(serverId: number): Promise<VideoQuotaConfigRow> {
  try {
    const [existing] = await sql<VideoQuotaConfigRow[]>`
      SELECT * FROM video_quota_configs WHERE server_id = ${serverId}
    `;
    if (existing) return videoQuotaConfigSchema.parse(existing);

    const [created] = await sql<VideoQuotaConfigRow[]>`
      INSERT INTO video_quota_configs (server_id, daily_user_quota, serverwide_quota, serverwide_quota_resets_in, enabled)
      VALUES (${serverId}, 0, 0, 365, false)
      RETURNING *
    `;
    return videoQuotaConfigSchema.parse(created);
  } catch (error) {
    log.error(`QuotaRepository.getOrCreateVideoConfig: failed for server ${serverId}`, error);
    return {
      server_id: serverId,
      daily_user_quota: 0,
      serverwide_quota: 0,
      serverwide_quota_resets_in: 365,
      enabled: false,
    };
  }
}

/**
 * Touch (get-or-init) a user's daily video quota record for today.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 * @param today      - Date string in YYYY-MM-DD format
 * @returns Parsed VideoQuotaRow
 */
export async function touchUserVideoQuota(serverId: number, userDiscId: string, today: string): Promise<VideoQuotaRow> {
  const [row] = await sql<VideoQuotaRow[]>`
    INSERT INTO video_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return videoQuotaSchema.parse(row);
}

/**
 * Touch (get-or-init) the server-wide video quota record.
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - Period length in days (from video_quota_configs)
 * @returns Parsed VideoServerwideQuotaRow
 */
export async function touchServerwideVideoQuota(serverId: number, resetDays: number): Promise<VideoServerwideQuotaRow> {
  const [row] = await sql<VideoServerwideQuotaRow[]>`
    INSERT INTO video_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    )
    ON CONFLICT (server_id)
    DO UPDATE SET server_id = EXCLUDED.server_id
    RETURNING *
  `;
  return videoServerwideQuotaSchema.parse(row);
}

/**
 * Reset the server-wide video quota period.
 *
 * @param serverId  - Internal server DB ID
 * @param resetDays - New period length in days
 * @returns Parsed VideoServerwideQuotaRow after reset
 */
export async function resetServerwideVideoPeriod(
  serverId: number,
  resetDays: number,
): Promise<VideoServerwideQuotaRow> {
  const [row] = await sql<VideoServerwideQuotaRow[]>`
    UPDATE video_serverwide_quotas
    SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${resetDays} || ' days')::interval
    WHERE server_id = ${serverId}
    RETURNING *
  `;
  return videoServerwideQuotaSchema.parse(row);
}

/** Claim one video generation on both counters or neither; database errors propagate so callers refuse. */
export async function reserveVideoQuotaUnits(
  serverId: number,
  userDiscId: string,
  config: VideoQuotaConfigRow,
): Promise<QuotaReservationOutcome> {
  const quotaDate = new Date().toISOString().split("T")[0];
  try {
    return await sql.begin(async (tx: SQL): Promise<QuotaReservationOutcome> => {
      let userCounted = false;
      let userRemaining: number | undefined;
      if (config.daily_user_quota > 0) {
        const [user] = await tx<{ usage_count: number }[]>`
          INSERT INTO video_quotas (server_id, user_disc_id, usage_count, quota_date)
          VALUES (${serverId}, ${userDiscId}, 1, ${quotaDate}::date)
          ON CONFLICT (server_id, user_disc_id, quota_date)
          DO UPDATE SET usage_count = video_quotas.usage_count + 1
          WHERE video_quotas.usage_count < ${config.daily_user_quota}
          RETURNING usage_count
        `;
        if (!user) throw new QuotaCapReached({ status: "user_quota_exceeded" });
        userCounted = true;
        userRemaining = config.daily_user_quota - user.usage_count;
      }

      let serverwidePeriodStart: string | null = null;
      let serverwideRemaining: number | undefined;
      let serverwidePeriodEnd: Date | undefined;
      if (config.serverwide_quota > 0) {
        const [pool] = await tx<{ period_start: string; quota_period_end: Date; usage_count: number }[]>`
          INSERT INTO video_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
          VALUES (
            ${serverId},
            1,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
          )
          ON CONFLICT (server_id) DO UPDATE SET
            usage_count = CASE WHEN video_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN 1 ELSE video_serverwide_quotas.usage_count + 1 END,
            quota_period_start = CASE WHEN video_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP ELSE video_serverwide_quotas.quota_period_start END,
            quota_period_end = CASE WHEN video_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
              ELSE video_serverwide_quotas.quota_period_end END
          WHERE video_serverwide_quotas.quota_period_end <= CURRENT_TIMESTAMP
            OR video_serverwide_quotas.usage_count < ${config.serverwide_quota}
          RETURNING quota_period_start::text AS period_start, quota_period_end, usage_count
        `;
        if (!pool) {
          const [current] = await tx<{ quota_period_end: Date }[]>`
            SELECT quota_period_end FROM video_serverwide_quotas WHERE server_id = ${serverId}
          `;
          throw new QuotaCapReached({ status: "serverwide_quota_exceeded", periodEnd: current.quota_period_end });
        }
        serverwidePeriodStart = pool.period_start;
        serverwideRemaining = config.serverwide_quota - pool.usage_count;
        serverwidePeriodEnd = pool.quota_period_end;
      }

      return {
        status: "reserved",
        reservation: { quotaDate, userCounted, serverwidePeriodStart },
        ...(userRemaining !== undefined ? { userRemaining } : {}),
        ...(serverwideRemaining !== undefined ? { serverwideRemaining } : {}),
        ...(serverwidePeriodEnd ? { serverwidePeriodEnd } : {}),
      };
    });
  } catch (error) {
    if (error instanceof QuotaCapReached) return error.outcome;
    throw error;
  }
}

/** A failed release leaves the unit counted, which over-counts rather than under-counts. */
export async function releaseVideoQuotaUnits(
  serverId: number,
  userDiscId: string,
  reservation: QuotaReservation,
): Promise<void> {
  try {
    await sql.begin(async (tx: SQL) => {
      if (reservation.userCounted) {
        await tx`
          UPDATE video_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId} AND user_disc_id = ${userDiscId}
            AND quota_date = ${reservation.quotaDate}::date
        `;
      }
      if (reservation.serverwidePeriodStart) {
        await tx`
          UPDATE video_serverwide_quotas SET usage_count = GREATEST(usage_count - 1, 0)
          WHERE server_id = ${serverId}
            AND quota_period_start = ${reservation.serverwidePeriodStart}::timestamp
        `;
      }
    });
  } catch (error) {
    log.error(`QuotaRepository.releaseVideoQuotaUnits: failed for server ${serverId}`, error);
  }
}

/**
 *
 * @param serverId - Internal server DB ID
 * @param limit    - New limit (0 = unlimited)
 */
export async function updateVideoDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE video_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

/**
 * Update the server-wide video quota limit, initializing the period row when
 * first enabling it (0 → N transition).
 *
 * @param serverId           - Internal server DB ID
 * @param limit              - New serverwide limit (0 = unlimited)
 * @param currentResetDays   - Current reset-days value from video_quota_configs
 * @param previousLimit      - Previous serverwide limit
 */
export async function updateVideoServerwideQuota(
  serverId: number,
  limit: number,
  currentResetDays: number,
  previousLimit: number,
): Promise<void> {
  await sql`UPDATE video_quota_configs SET serverwide_quota = ${limit} WHERE server_id = ${serverId}`;
  if (previousLimit === 0 && limit > 0) {
    await sql`
      INSERT INTO video_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
      VALUES (
        ${serverId},
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
      )
      ON CONFLICT (server_id) DO UPDATE SET
        usage_count        = 0,
        quota_period_start = CURRENT_TIMESTAMP,
        quota_period_end   = CURRENT_TIMESTAMP + (${currentResetDays} || ' days')::interval
    `;
  }
}

/**
 * Update the serverwide video quota reset period.
 *
 * @param serverId         - Internal server DB ID
 * @param days             - New reset period in days
 * @param serverwideActive - True when serverwide_quota > 0
 */
export async function updateVideoServerwideResetDays(
  serverId: number,
  days: number,
  serverwideActive: boolean,
): Promise<void> {
  await sql`UPDATE video_quota_configs SET serverwide_quota_resets_in = ${days} WHERE server_id = ${serverId}`;
  if (serverwideActive) {
    await sql`
      UPDATE video_serverwide_quotas
      SET quota_period_end = quota_period_start + (${days} || ' days')::interval
      WHERE server_id = ${serverId}
    `;
  }
}

/**
 * Admin reset: zero out a specific user's video quota for today.
 *
 * @param serverId   - Internal server DB ID
 * @param userDiscId - Discord user snowflake
 */
export async function resetUserDailyVideoQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO video_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

/**
 * Admin reset: reset the server-wide video quota pool.
 *
 * @param serverId - Internal server DB ID
 */
export async function resetServerwideVideoQuotaPool(serverId: number): Promise<void> {
  const config = await getOrCreateVideoConfig(serverId);
  await sql`
    INSERT INTO video_serverwide_quotas (server_id, usage_count, quota_period_start, quota_period_end)
    VALUES (
      ${serverId},
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
    )
    ON CONFLICT (server_id) DO UPDATE SET
      usage_count        = 0,
      quota_period_start = CURRENT_TIMESTAMP,
      quota_period_end   = CURRENT_TIMESTAMP + (${config.serverwide_quota_resets_in} || ' days')::interval
  `;
}
