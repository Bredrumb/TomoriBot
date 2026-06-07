// src/test-secrets.ts
import { getAppSecrets } from "@/utils/security/secretsManager";

async function test() {
  console.log("🔒 Attempting to fetch secrets from AWS...");

  try {
    // Force the function to use production mode (AWS Secrets Manager)
    process.env.RUN_ENV = "production";

    const secrets = await getAppSecrets();

    console.log("\n✅ SUCCESS! Connection established.");
    console.log("----------------------------------------");
    console.log(`Target Secret: tomoribot/production`);
    console.log(`Discord Token: ${secrets.DISCORD_TOKEN.slice(0, 5)}... (Verified)`);
    console.log(`DB Host:       ${secrets.POSTGRES_HOST} (Verified)`);
    console.log("----------------------------------------");
  } catch (error) {
    console.error("\n❌ FAILED to fetch secrets.");
    console.error("Error Details:", error);
    console.error("\nTroubleshooting:");
    console.error("1. Did you set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your terminal?");
    console.error("2. Is the region set correctly?");
    console.error("3. Does your IAM User ('admin') have permissions?");
  }
}

test();
