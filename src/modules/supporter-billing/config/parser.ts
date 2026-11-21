import { z } from "zod";
import {
  decisionSections,
  embeddingSections,
  imageSections,
  llmSections,
  speechSections,
  videoSections,
} from "@/db/seed/catalog/models";
import type { ModelSection } from "@/db/seed/catalog/types";
import { openrouterProviderInfo } from "@/providers/openrouter/providerInfo";
import type { AppEnvironment } from "@/types/config";
import { getOAuthPublicBaseUrl } from "@/utils/oauth/settings";

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
export const SUPPORTER_PROVIDER_VALUE = "supporter" as const;

type EnvRecord = Readonly<Record<string, string | undefined>>;

const nonEmptyStringSchema = z.string().trim().min(1);
const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const INHERIT_OPENROUTER_DEFAULT = "openrouter-default";
export const SUPPORTER_CAPABILITIES = ["text", "vision", "image", "video", "voice", "decision", "embedding"] as const;
export type SupporterCapability = (typeof SUPPORTER_CAPABILITIES)[number];
const urlStringSchema = nonEmptyStringSchema.refine(
  (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid URL" },
);
const envVarReferenceSchema = nonEmptyStringSchema.refine((value) => ENV_VAR_NAME_PATTERN.test(value), {
  message: "must be an uppercase environment variable name",
});

function seededOpenRouterDefault<
  T extends { provider: string; codename: string; isDefault?: boolean; isDeprecated?: boolean },
>(
  sections: readonly ModelSection<T>[],
  matches: (row: T) => boolean = (row) => row.isDefault === true,
): string | undefined {
  const rows = sections.flatMap((section) => section.rows);
  return rows.find((row) => row.provider === "openrouter" && !row.isDeprecated && matches(row))?.codename;
}

function modelDefaultSchema(catalogDefault: string | undefined) {
  return nonEmptyStringSchema.transform((value, context) => {
    if (value !== INHERIT_OPENROUTER_DEFAULT) return value;
    if (catalogDefault) return catalogDefault;
    context.addIssue({ code: "custom", message: "OpenRouter has no active seed default for this slot" });
    return z.NEVER;
  });
}

const supporterTierConfigSchema = z
  .object({
    displayNameKey: nonEmptyStringSchema.optional(),
    displayName: nonEmptyStringSchema.max(100).optional(),
    patreonTierIds: z.array(nonEmptyStringSchema).min(1),
    monthlyBudgetMicros: positiveIntegerSchema,
    defaultModelByCapability: z
      .object({
        text: modelDefaultSchema(seededOpenRouterDefault(llmSections)),
        vision: modelDefaultSchema(
          seededOpenRouterDefault(
            llmSections,
            (row) => row.codename === openrouterProviderInfo.defaultVisionModel && row.seesImages === true,
          ),
        ).optional(),
        image: modelDefaultSchema(seededOpenRouterDefault(imageSections)).optional(),
        video: modelDefaultSchema(seededOpenRouterDefault(videoSections)).optional(),
        embedding: modelDefaultSchema(seededOpenRouterDefault(embeddingSections)).optional(),
        decision: modelDefaultSchema(seededOpenRouterDefault(decisionSections)).optional(),
        voice: z
          .object({
            clone: modelDefaultSchema(
              seededOpenRouterDefault(speechSections, (row) => row.isDefault === true && row.voiceMode === "clone"),
            ).optional(),
            design: modelDefaultSchema(
              seededOpenRouterDefault(speechSections, (row) => row.isDefault === true && row.voiceMode === "design"),
            ).optional(),
          })
          .strict()
          .refine((voice) => !!voice.clone || !!voice.design, { message: "must define a clone or design default" })
          .optional(),
      })
      .strict(),
  })
  .strict()
  .refine((tier) => !!tier.displayNameKey !== !!tier.displayName, {
    message: "must define exactly one of displayNameKey or displayName",
  });

const supporterBillingConfigSchema = z
  .object({
    patreon: z
      .object({
        campaignId: nonEmptyStringSchema,
        oauthClientIdEnv: envVarReferenceSchema,
        oauthClientSecretEnv: envVarReferenceSchema,
        webhookSecretEnv: envVarReferenceSchema,
        creatorRefreshTokenEnv: envVarReferenceSchema,
        manageUrl: urlStringSchema,
      })
      .strict(),
    jobs: z
      .object({
        reconcileIntervalSeconds: positiveIntegerSchema,
        manualRefreshCooldownSeconds: positiveIntegerSchema,
      })
      .strict(),
    tiers: z.record(z.string().min(1), supporterTierConfigSchema),
  })
  .strict()
  .superRefine((config, context) => {
    const tierEntries = Object.entries(config.tiers);
    if (tierEntries.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["tiers"],
        message: "must define at least one tier",
      });
    }

    const seenPatreonTierIds = new Map<string, string>();

    for (const [tierKey, tier] of tierEntries) {
      for (const patreonTierId of tier.patreonTierIds) {
        const existingTierKey = seenPatreonTierIds.get(patreonTierId);
        if (existingTierKey) {
          context.addIssue({
            code: "custom",
            path: ["tiers", tierKey, "patreonTierIds"],
            message: `duplicates Patreon tier ID already used by tier "${existingTierKey}"`,
          });
        } else {
          seenPatreonTierIds.set(patreonTierId, tierKey);
        }
      }
    }
  });

export type SupporterBillingConfig = z.infer<typeof supporterBillingConfigSchema>;
export type SupporterBillingTierConfig = z.infer<typeof supporterTierConfigSchema>;

export interface ParseSupporterBillingConfigOptions {
  env?: EnvRecord;
  validateReferencedSecrets?: boolean;
}

export class SupporterBillingConfigError extends Error {
  public readonly issues: readonly string[];

  public constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "SupporterBillingConfigError";
    this.issues = issues;
  }
}

export function isSupporterBillingEnabled(environment: AppEnvironment, env: EnvRecord = process.env): boolean {
  return environment === "production" && env.TOMORI_SUPPORTER_BILLING_ENABLED?.trim() === "true";
}

export function parseSupporterBillingConfigJson(
  rawConfig: string | undefined,
  options: ParseSupporterBillingConfigOptions = {},
): SupporterBillingConfig {
  if (!rawConfig?.trim()) {
    throw new SupporterBillingConfigError(
      "TOMORI_SUPPORTER_CONFIG_JSON is required when supporter billing is enabled",
      ["TOMORI_SUPPORTER_CONFIG_JSON must contain a JSON object"],
    );
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    throw new SupporterBillingConfigError("TOMORI_SUPPORTER_CONFIG_JSON contains invalid JSON", [
      error instanceof Error ? error.message : "JSON parse failed",
    ]);
  }

  const schemaResult = supporterBillingConfigSchema.safeParse(parsedConfig);
  if (!schemaResult.success) {
    throw new SupporterBillingConfigError(
      "TOMORI_SUPPORTER_CONFIG_JSON failed validation",
      schemaResult.error.issues.map(formatZodIssue),
    );
  }

  if (options.validateReferencedSecrets) {
    if (!getOAuthPublicBaseUrl((options.env ?? process.env).TOMORI_PUBLIC_BASE_URL ?? "")) {
      throw new SupporterBillingConfigError("TOMORI_PUBLIC_BASE_URL is required for supporter billing");
    }
    validateReferencedSecretValues(schemaResult.data, options.env ?? process.env);
  }

  return schemaResult.data;
}

function getSupporterBillingReferencedEnvVars(config: SupporterBillingConfig): string[] {
  return Array.from(
    new Set([
      config.patreon.oauthClientIdEnv,
      config.patreon.oauthClientSecretEnv,
      config.patreon.webhookSecretEnv,
      config.patreon.creatorRefreshTokenEnv,
      "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
    ]),
  );
}

function validateReferencedSecretValues(config: SupporterBillingConfig, env: EnvRecord): void {
  const missingEnvVars = getSupporterBillingReferencedEnvVars(config).filter(
    (envName) => envName !== config.patreon.creatorRefreshTokenEnv && !env[envName]?.trim(),
  );

  if (missingEnvVars.length > 0) {
    throw new SupporterBillingConfigError("Supporter billing config references unset secret environment variables", [
      ...missingEnvVars.map((envName) => `${envName} must be set`),
    ]);
  }
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "config";
  return `${path}: ${issue.message}`;
}
