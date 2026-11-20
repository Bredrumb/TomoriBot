import type { SQL } from "bun";
import type {
  ImageQuotaConfigRow,
  ImageQuotaRow,
  ServerwideQuotaRow,
  TextQuotaConfigRow,
  VideoQuotaConfigRow,
  VideoQuotaRow,
  VideoServerwideQuotaRow,
} from "@/types/db/schema";
import {
  imageQuotaConfigSchema,
  imageQuotaSchema,
  serverwideQuotaSchema,
  textQuotaConfigSchema,
  videoQuotaConfigSchema,
  videoQuotaSchema,
  videoServerwideQuotaSchema,
} from "@/types/db/schema";
import { sql, withTransientDbRetry } from "@/utils/db/client";
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
  // Exact text rather than Date because a JS Date drops the microseconds that the release query must match.
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

export async function getTextConfigResult(serverId: number): Promise<TextQuotaConfigReadResult> {
  try {
    const [existing] = await withTransientDbRetry(
      () => sql<TextQuotaConfigRow[]>`
      SELECT * FROM text_quota_configs WHERE server_id = ${serverId}
      `,
      "load text quota config",
    );
    return {
      status: "fresh",
      config: existing ? textQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getTextConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

export async function getImageConfigResult(serverId: number): Promise<ImageQuotaConfigReadResult> {
  try {
    const [existing] = await withTransientDbRetry(
      () => sql<ImageQuotaConfigRow[]>`
      SELECT * FROM image_quota_configs WHERE server_id = ${serverId}
      `,
      "load image quota config",
    );
    return {
      status: "fresh",
      config: existing ? imageQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getImageConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

export async function getVideoConfigResult(serverId: number): Promise<VideoQuotaConfigReadResult> {
  try {
    const [existing] = await withTransientDbRetry(
      () => sql<VideoQuotaConfigRow[]>`
      SELECT * FROM video_quota_configs WHERE server_id = ${serverId}
      `,
      "load video quota config",
    );
    return {
      status: "fresh",
      config: existing ? videoQuotaConfigSchema.parse(existing) : null,
    };
  } catch (error) {
    log.error(`QuotaRepository.getVideoConfigResult: failed for server ${serverId}`, error);
    return { status: "unavailable", config: null };
  }
}

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

// Text quota counters commit atomically so callers fail closed on DB errors.
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

// Failed text quota release logs instead of throwing so it fails safe by over-counting.
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

// Callers must ensure the config row exists via getOrCreateTextConfig since UPDATE will not insert it, and limit 0
// means unlimited.
export async function updateTextDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE text_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

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

export async function resetUserDailyTextQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO text_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

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

// Image quota counters commit atomically so callers fail closed on DB errors.
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

// Failed image quota release logs instead of throwing so it fails safe by over-counting.
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

// Limit 0 means unlimited rather than zero allowed: only positive values enforce a daily image cap.
export async function updateImageDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE image_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

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

export async function resetUserDailyImageQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO image_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

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

// Video quota counters commit atomically so callers fail closed on DB errors.
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

// Failed video quota release logs instead of throwing so it fails safe by over-counting.
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

// Limit 0 means unlimited rather than zero allowed: only positive values enforce a daily video cap.
export async function updateVideoDailyUserQuota(serverId: number, limit: number): Promise<void> {
  await sql`UPDATE video_quota_configs SET daily_user_quota = ${limit} WHERE server_id = ${serverId}`;
}

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

export async function resetUserDailyVideoQuota(serverId: number, userDiscId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await sql`
    INSERT INTO video_quotas (server_id, user_disc_id, usage_count, quota_date)
    VALUES (${serverId}, ${userDiscId}, 0, ${today}::date)
    ON CONFLICT (server_id, user_disc_id, quota_date)
    DO UPDATE SET usage_count = 0
  `;
}

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
