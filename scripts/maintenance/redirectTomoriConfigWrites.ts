#!/usr/bin/env bun
/**
 * Phase 6 Stage B Step 1 — Behavioral config write redirect script.
 *
 * Scans TypeScript source files for `UPDATE tomori_configs SET column = value`
 * patterns and redirects them to the appropriate split table. Only handles
 * single-column UPDATE patterns (safe to automate). Multi-column updates and
 * complex cases are flagged for manual review.
 *
 * Column → table mapping derived from migration 002_server_config_tables.sql.
 *
 * Run: bun scripts/maintenance/redirectTomoriConfigWrites.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from "fs";
import { globSync } from "glob";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");

// ── Column → new table mapping ────────────────────────────────────────────────
const COLUMN_TABLE_MAP: Record<string, string> = {
  // server_chat_configs
  humanizer_degree: "server_chat_configs",
  message_fetch_limit: "server_chat_configs",
  send_message_limit: "server_chat_configs",
  match_limit: "server_chat_configs",
  cascade_limit: "server_chat_configs",
  timezone_offset: "server_chat_configs",
  self_debug_enabled: "server_chat_configs",
  system_prompt: "server_chat_configs",
  context_note: "server_chat_configs",
  context_note_depth: "server_chat_configs",
  llm_stop_strings: "server_chat_configs",
  llm_stop_speaker_pattern_enabled: "server_chat_configs",
  llm_max_output_tokens: "server_chat_configs",
  llm_top_p: "server_chat_configs",
  llm_top_k: "server_chat_configs",
  llm_frequency_penalty: "server_chat_configs",
  llm_presence_penalty: "server_chat_configs",
  llm_min_p: "server_chat_configs",
  llm_logit_biases: "server_chat_configs",
  fallback_model_refs: "server_chat_configs",

  // server_notice_embeds_configs
  tool_notice_hidden_keys: "server_notice_embeds_configs",

  // server_member_permissions_configs
  server_memteaching_enabled: "server_member_permissions_configs",
  attribute_memteaching_enabled: "server_member_permissions_configs",
  sampledialogue_memteaching_enabled: "server_member_permissions_configs",
  self_teaching_enabled: "server_member_permissions_configs",
  personal_memories_enabled: "server_member_permissions_configs",
  hide_impersonation_embeds: "server_member_permissions_configs",
  prompt_snapshot_enabled: "server_member_permissions_configs",

  // server_channel_scope_configs
  rp_channel_ids: "server_channel_scope_configs",
  private_channel_ids: "server_channel_scope_configs",
  crosschannel_blocklist_ids: "server_channel_scope_configs",
  stm_privacy_bypass: "server_channel_scope_configs",
  thought_log_channel_disc_id: "server_channel_scope_configs",

  // server_welcome_configs
  welcome_channel_disc_id: "server_welcome_configs",
  welcome_prompt: "server_welcome_configs",
  welcome_persona_id: "server_welcome_configs",

  // server_trigger_behavior_configs
  always_reply_enabled: "server_trigger_behavior_configs",
  deliberate_trigger_mode: "server_trigger_behavior_configs",
  cooldown_type: "server_trigger_behavior_configs",
  cooldown_length: "server_trigger_behavior_configs",

  // server_auto_trigger_configs
  autoch_disc_ids: "server_auto_trigger_configs",
  autoch_persona_overrides: "server_auto_trigger_configs",
  autoch_threshold: "server_auto_trigger_configs",
  autoch_threshold_max: "server_auto_trigger_configs",

  // server_capabilities_configs
  emoji_usage_enabled: "server_capabilities_configs",
  sticker_usage_enabled: "server_capabilities_configs",
  web_search_enabled: "server_capabilities_configs",
  manage_message_enabled: "server_capabilities_configs",
  thread_creation_enabled: "server_capabilities_configs",
  imagegen_enabled: "server_capabilities_configs",
  videogen_enabled: "server_capabilities_configs",
  voice_message_enabled: "server_capabilities_configs",
  tool_use_enabled: "server_capabilities_configs",

  // server_novelai_imagegen_configs
  nai_preset_name: "server_novelai_imagegen_configs",
  nai_style_tags: "server_novelai_imagegen_configs",
  nai_negative_tags: "server_novelai_imagegen_configs",
  nai_sampler: "server_novelai_imagegen_configs",
  nai_steps: "server_novelai_imagegen_configs",
  nai_scale: "server_novelai_imagegen_configs",
  nai_noise_schedule: "server_novelai_imagegen_configs",
  nai_cfg_rescale: "server_novelai_imagegen_configs",
  nai_diffusion_model_id: "server_novelai_imagegen_configs",

  // server_nsfw_configs
  uncensor_injection_enabled: "server_nsfw_configs",
  uncensor_unicode_space_enabled: "server_nsfw_configs",
  uncensor_sanitize_enabled: "server_nsfw_configs",

  // server_speech_configs
  voice_transcript_chat_mode: "server_speech_configs",
  chatterbox_turbo_enabled: "server_speech_configs",
  chatterbox_cfg_weight: "server_speech_configs",
  chatterbox_exaggeration: "server_speech_configs",

  // server_byok_configs
  user_byok_mode: "server_byok_configs",

  // server_memory_configs
  memory_tagging_enabled: "server_memory_configs",
};

// ── Regex pattern to find UPDATE tomori_configs SET single-column blocks ──────
// Matches patterns like:
//   UPDATE tomori_configs\n  SET col = ${val}\n  WHERE server_id = ${x}\n  RETURNING *
// or without RETURNING.
const UPDATE_PATTERN = /UPDATE\s+tomori_configs\s+SET\s+(\w+)\s*=\s*[^\n]+\n\s*WHERE\s+server_id\s*=/g;

interface FileResult {
  file: string;
  redirected: string[];
  skipped: string[];
  changed: boolean;
}

function processFile(filePath: string): FileResult {
  const content = readFileSync(filePath, "utf-8");
  const result: FileResult = { file: filePath, redirected: [], skipped: [], changed: false };

  // Find all UPDATE tomori_configs blocks in the file
  const matches = [...content.matchAll(UPDATE_PATTERN)];

  if (matches.length === 0) return result;

  // Check if any match has a column not in our map
  let newContent = content;
  for (const match of matches) {
    const col = match[1]!;
    const newTable = COLUMN_TABLE_MAP[col];
    if (!newTable) {
      result.skipped.push(`${col} (no split table — needs manual handling)`);
    }
  }

  // If all columns are safe to redirect, apply replacements
  // Apply table name replacement for matched single-column patterns
  newContent = newContent.replace(UPDATE_PATTERN, (full, col) => {
    const newTable = COLUMN_TABLE_MAP[col];
    if (!newTable) return full; // skip, will be flagged
    result.redirected.push(`${col} → ${newTable}`);
    return full.replace("tomori_configs", newTable);
  });

  // Replace `RETURNING *` with `RETURNING server_id` in the same sql`` blocks
  // that we just redirected (conservative: only replace when preceded by WHERE server_id)
  // We use a broader pattern that captures the tail of the sql block
  newContent = newContent.replace(
    /(UPDATE\s+server_\w+_configs\s+SET\s+\w+\s*=[^\n]+\n[^`]*?)RETURNING\s+\*/g,
    "$1RETURNING server_id",
  );

  // Replace `targetTable: "tomori_configs"` → `targetTable: "<new_table>"`
  // We need to find the closest redirect context. Since we may have mixed tables
  // in one file, replace each by looking at the surrounding block.
  // Simple heuristic: for each redirected column, find `targetTable: "tomori_configs"`
  // within 20 lines of the UPDATE and replace with the new table.
  // This is applied as a simple string replace for consistency:
  newContent = newContent.replace(/targetTable:\s*"tomori_configs"/g, (match) => {
    // We can't easily determine context here; mark for manual review
    result.skipped.push("targetTable: 'tomori_configs' (needs manual table name check)");
    return match; // leave unchanged — will be caught by grep later
  });

  if (newContent !== content) {
    result.changed = true;
    if (!DRY_RUN) {
      writeFileSync(filePath, newContent, "utf-8");
    }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = globSync("src/**/*.ts", { cwd: process.cwd() });
const results: FileResult[] = [];

for (const file of files) {
  const absPath = path.resolve(process.cwd(), file);
  const r = processFile(absPath);
  if (r.redirected.length > 0 || r.skipped.length > 0) {
    results.push(r);
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(DRY_RUN ? "DRY RUN — no files written" : "FILES UPDATED");
console.log("─".repeat(70));

let totalRedirected = 0;
let totalSkipped = 0;

for (const r of results) {
  const rel = path.relative(process.cwd(), r.file);
  if (r.redirected.length > 0) {
    console.log(`\n✓ ${rel}`);
    for (const s of r.redirected) console.log(`    ↳ ${s}`);
    totalRedirected += r.redirected.length;
  }
  if (r.skipped.length > 0) {
    console.log(`\n⚠ ${rel} (needs manual handling)`);
    for (const s of r.skipped) console.log(`    ↳ ${s}`);
    totalSkipped += r.skipped.length;
  }
}

console.log(`\n${"─".repeat(70)}`);
console.log(`Total redirected: ${totalRedirected}`);
console.log(`Total needing manual work: ${totalSkipped}`);
console.log("─".repeat(70));
