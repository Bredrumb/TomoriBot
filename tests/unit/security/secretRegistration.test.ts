import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REGISTERED_NAME = "TOMORI_DEPLOYMENT_EXTRA_SECRET";
const UNREGISTERED_NAME = "TOMORI_DEPLOYMENT_UNREGISTERED_SECRET";

const BASE_DOTENV = {
  RUN_ENV: "development",
  DISCORD_TOKEN: "test-discord-token",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "test-password",
  POSTGRES_DB: "test-database",
  CRYPTO_SECRET: "test-crypto-secret",
};

const BASE_SECRETS: Record<string, string> = {
  DISCORD_TOKEN: "test-discord-token",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "test-password",
  POSTGRES_DB: "test-database",
  CRYPTO_SECRET: "test-crypto-secret",
};

interface ScenarioResult {
  retentionRejected?: boolean;
  value?: string;
  unregistered?: string;
  lateRegistrationRejected?: boolean;
  ownerRefused?: boolean;
}

async function runScenario(
  script: string,
  overrides: Record<string, string>,
  removed: string[],
): Promise<ScenarioResult> {
  const env: Record<string, string | undefined> = { ...process.env, ...overrides };
  for (const key of removed) delete env[key];

  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) throw new Error(`Scenario failed (exit ${exitCode}): ${stderr}`);
  const line = stdout.split("\n").find((candidate) => candidate.includes('"marker":"secret-registration"'));
  if (!line) throw new Error(`Scenario produced no result line: ${stdout}`);
  return JSON.parse(line) as ScenarioResult;
}

describe("registered application secret names", () => {
  it("loads both retention policies from the mounted bundle before validating ambient values", async () => {
    const secretDir = await mkdtemp(path.join(os.tmpdir(), "tomoribot-retention-file-"));
    const secretFile = path.join(secretDir, "secrets.json");
    try {
      await writeFile(
        secretFile,
        JSON.stringify({ ...BASE_SECRETS, RECORD_RETENTION_DAYS: 90, API_KEY_INACTIVITY_DAYS: 90 }),
      );
      const result = await runScenario(
        `import { loadSecrets } from "./src/init/secrets";
         await loadSecrets("production");
         console.log(JSON.stringify({ marker: "secret-registration", value: process.env.RECORD_RETENTION_DAYS + ":" + process.env.API_KEY_INACTIVITY_DAYS }));`,
        {
          ...BASE_DOTENV,
          RUN_ENV: "production",
          SECRET_FILE: secretFile,
          RECORD_RETENTION_DAYS: "0",
          API_KEY_INACTIVITY_DAYS: "0",
        },
        ["GCP_SECRET_FILE", "TEST_PRODUCTION"],
      );
      expect(result.value).toBe("90:90");
      for (const name of ["RECORD_RETENTION_DAYS", "API_KEY_INACTIVITY_DAYS"]) {
        await writeFile(secretFile, JSON.stringify({ ...BASE_SECRETS, [name]: "" }));
        const invalid = await runScenario(
          `import { loadSecrets } from "./src/init/secrets";
           let retentionRejected = false;
           try { await loadSecrets("production"); } catch { retentionRejected = true; }
           console.log(JSON.stringify({ marker: "secret-registration", retentionRejected }));`,
          { ...BASE_DOTENV, RUN_ENV: "production", SECRET_FILE: secretFile },
          ["GCP_SECRET_FILE", "TEST_PRODUCTION", "RECORD_RETENTION_DAYS", "API_KEY_INACTIVITY_DAYS"],
        );
        expect(invalid.retentionRejected).toBe(true);
      }
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });
  it("loads a registered name from the environment and rejects registration after loading", async () => {
    const result = await runScenario(
      `import { getAppSecrets, registerSecretEnvKeys } from "./src/utils/security/secretsManager";
       registerSecretEnvKeys(["${REGISTERED_NAME}"]);
       process.env.${REGISTERED_NAME} = "from-environment";
       process.env.${UNREGISTERED_NAME} = "ambient-only";
       const secrets = await getAppSecrets();
       let lateRegistrationRejected = false;
       try {
         registerSecretEnvKeys(["TOMORI_DEPLOYMENT_LATE_SECRET"]);
       } catch {
         lateRegistrationRejected = true;
       }
       console.log(JSON.stringify({
         marker: "secret-registration",
         value: secrets.${REGISTERED_NAME},
         unregistered: secrets.${UNREGISTERED_NAME},
         lateRegistrationRejected,
       }));`,
      BASE_DOTENV,
      ["SECRET_FILE", "GCP_SECRET_FILE", "TEST_PRODUCTION"],
    );

    expect(result.value).toBe("from-environment");
    expect(result.unregistered).toBeUndefined();
    expect(result.lateRegistrationRejected).toBe(true);
  });

  it("loads a registered name from a mounted secret file", async () => {
    const secretDir = await mkdtemp(path.join(os.tmpdir(), "tomoribot-secret-file-"));
    const secretFile = path.join(secretDir, "secrets.json");
    try {
      await writeFile(
        secretFile,
        JSON.stringify({
          ...BASE_SECRETS,
          [REGISTERED_NAME]: "from-secret-file",
          [UNREGISTERED_NAME]: "should-not-load",
        }),
      );

      const result = await runScenario(
        `import { getAppSecrets, registerSecretEnvKeys } from "./src/utils/security/secretsManager";
         registerSecretEnvKeys(["${REGISTERED_NAME}"]);
         const secrets = await getAppSecrets();
         console.log(JSON.stringify({
           marker: "secret-registration",
           value: secrets.${REGISTERED_NAME},
           unregistered: secrets.${UNREGISTERED_NAME},
         }));`,
        { ...BASE_DOTENV, RUN_ENV: "production", SECRET_FILE: secretFile },
        ["GCP_SECRET_FILE", "TEST_PRODUCTION"],
      );

      expect(result.value).toBe("from-secret-file");
      expect(result.unregistered).toBeUndefined();
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  it("keeps an empty Vertex owner list from a mounted secret file so it admits no one", async () => {
    const secretDir = await mkdtemp(path.join(os.tmpdir(), "tomoribot-secret-file-"));
    const secretFile = path.join(secretDir, "secrets.json");
    try {
      await writeFile(secretFile, JSON.stringify({ ...BASE_SECRETS, VERTEX_ALLOWED_OWNERS: "" }));

      const result = await runScenario(
        `import { loadSecrets } from "./src/init/secrets";
         import { isVertexOwnerAllowed } from "./src/providers/vertex/vertexClient";
         await loadSecrets("production");
         console.log(JSON.stringify({
           marker: "secret-registration",
           value: process.env.VERTEX_ALLOWED_OWNERS === undefined ? "unset" : "set",
           ownerRefused: !isVertexOwnerAllowed("111111111111111111"),
         }));`,
        { ...BASE_DOTENV, RUN_ENV: "production", SECRET_FILE: secretFile },
        ["GCP_SECRET_FILE", "TEST_PRODUCTION", "VERTEX_ALLOWED_OWNERS"],
      );

      expect(result.value).toBe("set");
      expect(result.ownerRefused).toBe(true);
    } finally {
      await rm(secretDir, { recursive: true, force: true });
    }
  });

  it("loads a registered name from AWS Secrets Manager", async () => {
    const result = await runScenario(
      `import { mock } from "bun:test";
       const secretString = ${JSON.stringify(
         JSON.stringify({
           ...BASE_SECRETS,
           [REGISTERED_NAME]: "from-aws",
           [UNREGISTERED_NAME]: "should-not-load",
         }),
       )};
       mock.module("@aws-sdk/client-secrets-manager", () => ({
         SecretsManagerClient: class {
           async send() {
             return { SecretString: secretString };
           }
         },
         GetSecretValueCommand: class {},
       }));
       const { getAppSecrets, registerSecretEnvKeys } = await import("./src/utils/security/secretsManager");
       registerSecretEnvKeys(["${REGISTERED_NAME}"]);
       const secrets = await getAppSecrets();
       console.log(JSON.stringify({
         marker: "secret-registration",
         value: secrets.${REGISTERED_NAME},
         unregistered: secrets.${UNREGISTERED_NAME},
       }));`,
      { ...BASE_DOTENV, RUN_ENV: "production" },
      ["SECRET_FILE", "GCP_SECRET_FILE", "TEST_PRODUCTION"],
    );

    expect(result.value).toBe("from-aws");
    expect(result.unregistered).toBeUndefined();
  });
});
