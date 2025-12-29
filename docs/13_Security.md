# 13. Security & Privacy

This document explains TomoriBot's security architecture and privacy features.

## Overview

TomoriBot implements multiple security layers:
- **Encrypted Storage** for API keys
- **Key Versioning** for rotation
- **Privacy Controls** for users
- **GDPR Compliance** with data export/delete
- **SQL Injection Prevention**
- **Rate Limiting** via cooldowns

## Encryption System

### Technology Stack

**Library:** libsodium-wrappers

**Algorithm:** XSalsa20-Poly1305 (authenticated encryption)
- **Encryption:** XSalsa20 stream cipher
- **Authentication:** Poly1305 MAC
- **Key Derivation:** PBKDF2-SHA256

### Encrypted Data

Two types of data are encrypted:
1. **API Keys** - LLM provider keys (Google, NovelAI)
2. **Optional API Keys** - Service keys (Brave Search)

**Storage Format:** BYTEA (binary) in PostgreSQL

### Key Manager

**File:** `src/utils/security/keyManager.ts`

**Singleton Pattern:**
```typescript
class KeyManager {
  private keys: Map<number, Buffer>; // version → key
  private currentVersion: number;
}

export const keyManager = new KeyManager();
```

**Initialization:**
```typescript
constructor() {
  const cryptoSecret = process.env.CRYPTO_SECRET;
  if (!cryptoSecret) {
    throw new Error("CRYPTO_SECRET required");
  }

  // Derive encryption key from secret
  const derivedKey = this.deriveKey(cryptoSecret, "main", 1);
  this.keys.set(1, derivedKey);
  this.currentVersion = 1;
}
```

**Key Derivation:**
```typescript
private deriveKey(secret: string, context: string, version: number): Buffer {
  // Use PBKDF2 to derive 32-byte key
  const iterations = 100000;
  const keyLength = 32;
  const salt = `tomoribot:${context}:v${version}`;

  return crypto.pbkdf2Sync(
    secret,
    salt,
    iterations,
    keyLength,
    "sha256"
  );
}
```

## Encryption/Decryption

**File:** `src/utils/security/crypto.ts`

### Encrypt Data

```typescript
function encryptData(
  plaintext: string,
  contextId: string,
  keyVersion: number = 1
): Buffer {
  const key = keyManager.getKey(keyVersion);
  const nonce = crypto.randomBytes(24); // XSalsa20 nonce

  // Derive per-context key (defense in depth)
  const contextKey = deriveContextKey(key, contextId);

  // Encrypt with libsodium
  const ciphertext = sodium.crypto_secretbox_easy(
    Buffer.from(plaintext, "utf8"),
    nonce,
    contextKey
  );

  // Format: [version(1)] [nonce(24)] [ciphertext(?)]
  return Buffer.concat([
    Buffer.from([keyVersion]),
    nonce,
    ciphertext
  ]);
}
```

### Decrypt Data

```typescript
function decryptData(
  encrypted: Buffer,
  contextId: string
): string {
  // Parse format
  const version = encrypted[0];
  const nonce = encrypted.subarray(1, 25);
  const ciphertext = encrypted.subarray(25);

  // Get versioned key
  const key = keyManager.getKey(version);
  const contextKey = deriveContextKey(key, contextId);

  // Decrypt with libsodium
  const plaintext = sodium.crypto_secretbox_open_easy(
    ciphertext,
    nonce,
    contextKey
  );

  if (!plaintext) {
    throw new Error("Decryption failed - authentication check failed");
  }

  return Buffer.from(plaintext).toString("utf8");
}
```

### API Key Helpers

```typescript
// Encrypt API key for storage
function encryptApiKey(apiKey: string, serverId: number): Buffer {
  return encryptData(apiKey, `server:${serverId}`, keyManager.getCurrentKeyVersion());
}

// Decrypt API key from database
function decryptApiKey(
  encrypted: Buffer,
  serverId: number,
  keyVersion: number
): string {
  return decryptData(encrypted, `server:${serverId}`);
}
```

### Example Usage

```typescript
// Storing API key
const serverId = 123;
const apiKey = "sk-abc123xyz";
const encrypted = encryptApiKey(apiKey, serverId);

await sql`
  UPDATE tomori_configs
  SET api_key = ${encrypted}, key_version = ${keyManager.getCurrentKeyVersion()}
  WHERE tomori_id = ${tomoriId}
`;

// Retrieving API key
const [row] = await sql`
  SELECT api_key, key_version FROM tomori_configs WHERE tomori_id = ${tomoriId}
`;

const decrypted = decryptApiKey(row.api_key, serverId, row.key_version);
// → "sk-abc123xyz"
```

## Key Versioning & Rotation

### Why Version Keys?

- **Zero-downtime rotation**: Old data readable during migration
- **Gradual re-encryption**: No big-bang migration needed
- **Audit trail**: Track which keys encrypted which data
- **Security**: Limit blast radius if key compromised

### Version Tracking

Each encrypted value has associated `key_version`:

```sql
CREATE TABLE tomori_configs (
  api_key BYTEA,
  key_version INTEGER DEFAULT 1,
  ...
);

CREATE TABLE opt_api_keys (
  api_key BYTEA,
  key_version INTEGER DEFAULT 1,
  ...
);
```

### Rotation Process

**Script:** `bun run rotate-keys`

**File:** `scripts/rotateAllKeys.ts`

**Steps:**

1. **Add New Key Version**
```typescript
keyManager.addKeyVersion(2, newSecret);
```

2. **New Writes Use New Version**
```typescript
const encrypted = encryptApiKey(apiKey, serverId); // Uses v2
await sql`
  UPDATE tomori_configs
  SET api_key = ${encrypted}, key_version = 2
  WHERE tomori_id = ${tomoriId}
`;
```

3. **Old Data Still Readable**
```typescript
// Old data encrypted with v1
const oldEncrypted = row.api_key; // Contains version byte
const decrypted = decryptApiKey(oldEncrypted, serverId, row.key_version);
// KeyManager automatically uses v1 key
```

4. **Re-encrypt Old Data** (optional, gradual)
```typescript
for (const row of oldRows) {
  const plaintext = decryptApiKey(row.api_key, row.server_id, row.key_version);
  const newEncrypted = encryptApiKey(plaintext, row.server_id); // v2
  await sql`
    UPDATE tomori_configs
    SET api_key = ${newEncrypted}, key_version = 2
    WHERE tomori_id = ${row.tomori_id}
  `;
}
```

### Audit Key Usage

**Script:** `bun run audit-keys`

**File:** `scripts/auditKeyVersions.ts`

**Output:**
```
Auditing encryption key versions...

tomori_configs:
  Version 1: 15 entries
  Version 2: 3 entries

opt_api_keys:
  Version 1: 8 entries
  Version 2: 1 entry

Total entries: 27
Migration progress: 14.8%
```

## Privacy Features

### User Privacy Controls

#### 1. Privacy Levels (Global)

**Command:** `/personal privacy level:<level>`

**Three Privacy Levels:**

**Level 0 - MINIMAL Privacy (Default):**
- Full personalization enabled
- Personal memories saved
- Conversation history stored for context
- Analytics tracked for improvement
- All bot features available

**Level 1 - PARTIAL Privacy:**
- Limited personalization
- Only essential memories saved
- Reduced conversation history
- Basic analytics only
- Some features may be restricted

**Level 2 - FULL Privacy (Maximum):**
- No personal memories saved
- No conversation history stored
- No analytics tracked
- User data minimal (only Discord ID + privacy level)
- Equivalent to old "opt-out" mode

**Database:**
```sql
-- Set to FULL privacy (replaces old privacy_opt_out = true)
UPDATE users SET privacy_level = 2 WHERE user_disc_id = '123456789';

-- Set to MINIMAL privacy (default)
UPDATE users SET privacy_level = 0 WHERE user_disc_id = '123456789';
```

**Migration Note:** The old `privacy_opt_out` boolean was migrated to `privacy_level` in late 2025:
- `false` (opted in) → `0` (MINIMAL)
- `true` (opted out) → `2` (FULL)

#### 2. Server Blacklist (Per-Server)

**Command:** `/server blacklist action:add user:@user`

**Effect:**
- User excluded from personalization in that server only
- Can still use bot, but no memory/learning
- Opt-out persists even if user leaves and rejoins

**Database:**
```sql
INSERT INTO personalization_blacklist (server_id, user_disc_id)
VALUES (1, '123456789');
```

#### 3. Data Export (GDPR)

**Command:** `/data export`

**Effect:**
- Bot DMs user a JSON file with all their data
- Includes: personal memories, nicknames, language preference
- Excludes: encrypted API keys (security)

**Example Export:**
```json
{
  "user_disc_id": "123456789",
  "user_nickname": "Alice",
  "language_pref": "en",
  "personal_memories": [
    "User likes pizza",
    "User's favorite color is blue"
  ],
  "privacy_level": 0,
  "privacy_level_description": "MINIMAL (full features)",
  "created_at": "2024-01-15T10:30:00Z",
  "servers": [
    {
      "server_id": "987654321",
      "blacklisted": false
    }
  ]
}
```

#### 4. Data Deletion (Right to be Forgotten)

**Command:** `/data delete confirm:true`

**Effect:**
- **Deletes all user data** from database
- **Irreversible operation**
- User must type confirmation

**Warning Message:**
```
⚠️ WARNING: This will permanently delete all your data!

This includes:
- Personal memories
- User preferences
- All history

This action CANNOT be undone!

Type "DELETE MY DATA" to confirm:
```

**Database Operations:**
```sql
-- Delete user (CASCADE deletes related data)
DELETE FROM users WHERE user_disc_id = '123456789';

-- Delete blacklist entries
DELETE FROM personalization_blacklist WHERE user_disc_id = '123456789';

-- Nullify foreign keys in memories (preserve memories, remove attribution)
UPDATE server_memories SET user_id = NULL WHERE user_id = <user_id>;
```

### Data Minimization

TomoriBot only stores what's necessary:

**Stored:**
- Discord user ID (required for functionality)
- User preferences (nickname, language)
- Memories (if not opted out)
- Server configurations

**NOT Stored:**
- Message content (unless explicitly taught as memory)
- IP addresses
- Device information
- Full conversation logs (only recent history for context)

### Access Control

**Manager Permissions:** Certain commands require Discord "Manage Server" permission:
- `/config apikey set/delete`
- `/config model`
- `/server blacklist`
- `/server avatar`

**Checked in Code:**
```typescript
if (!interaction.memberPermissions?.has("ManageGuild")) {
  await interaction.reply({
    content: t("errors.permission_denied"),
    ephemeral: true
  });
  return;
}
```

## SQL Injection Prevention

All database queries use **parameterized queries** (Bun SQL):

❌ **Vulnerable (NEVER DO THIS):**
```typescript
const serverId = interaction.guild.id;
await sql`SELECT * FROM servers WHERE server_disc_id = '${serverId}'`;
// String interpolation = SQL injection risk!
```

✅ **Safe:**
```typescript
const serverId = interaction.guild.id;
await sql`SELECT * FROM servers WHERE server_disc_id = ${serverId}`;
// Parameterized = safe!
```

**Bun SQL automatically:**
- Escapes parameters
- Uses prepared statements
- Prevents injection attacks

## Rate Limiting

### Cooldown System

**Table:** `cooldowns` (unlogged for performance)

**Mechanism:**
```typescript
const cooldownKey = `${userId}:${commandCategory}`;
const cooldownMs = 3000; // 3 seconds

// Check cooldown
const [existing] = await sql`
  SELECT expiry_time FROM cooldowns
  WHERE user_disc_id = ${userId} AND command_category = ${commandCategory}
`;

if (existing && existing.expiry_time > Date.now()) {
  await interaction.reply("You're using commands too quickly!");
  return;
}

// Set cooldown
const expiryTime = Date.now() + cooldownMs;
await sql`
  INSERT INTO cooldowns (user_disc_id, command_category, expiry_time)
  VALUES (${userId}, ${commandCategory}, ${expiryTime})
  ON CONFLICT (user_disc_id, command_category)
  DO UPDATE SET expiry_time = ${expiryTime}
`;
```

**Cooldown Categories:**
- `config`: 3 seconds
- `teach`: 5 seconds
- `forget`: 3 seconds
- `persona`: 10 seconds
- `data`: 30 seconds (export/delete)

### API Rate Limiting

Provider APIs have their own limits:

**Google Gemini:**
- Free tier: 15 RPM (requests per minute)
- Paid tier: Higher limits

**Handling:**
```typescript
try {
  const response = await provider.generateCompletion(...);
} catch (error) {
  if (error.code === 429) { // Rate limit
    await interaction.reply("API rate limit reached. Please wait a moment.");
  }
}
```

## Security Best Practices

### 1. Environment Variables

Never commit secrets to Git:

```bash
# .gitignore
.env
.env.local
.env.*.local
```

### 2. Secure Defaults

Default to secure configuration:
- Privacy opt-out defaults to `false` (users must explicitly opt out)
- Cooldowns enabled by default
- Manager permissions required for sensitive operations

### 3. Error Messages

Don't leak sensitive info in errors:

❌ **Bad:**
```typescript
throw new Error(`Failed to decrypt API key: ${apiKey}`);
```

✅ **Good:**
```typescript
throw new Error("Failed to decrypt API key - invalid key or corruption");
```

### 4. Logging

Don't log sensitive data:

❌ **Bad:**
```typescript
log.info(`API key set: ${apiKey}`);
```

✅ **Good:**
```typescript
log.info("API key set successfully");
```

## Security Auditing

**Regular Tasks:**

1. **Audit Key Versions:** `bun run audit-keys`
2. **Check Locale Keys:** `bun run check-locales`
3. **Review Error Logs:**
```sql
SELECT * FROM error_logs
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

4. **Monitor Failed Decryptions:**
Check logs for decryption failures (potential tampering).

## Next Steps

Read document 14 (Common Development Tasks) for practical guides on extending TomoriBot!
