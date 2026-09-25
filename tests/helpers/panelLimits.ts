import { expect } from "bun:test";
import { ComponentType } from "discord.js";
import {
  type ComponentsV2MessagePayload,
  validateComponentsV2MessageLimits,
} from "@/utils/discord/ui/componentsV2Limits";

/**
 * Fence lengths that stress the fence-escaping path: 3 opens a fence, and 4-8 cover the runs a
 * naive escaper would let terminate or extend it.
 */
export const BACKTICK_RUNS: readonly number[] = [3, 4, 5, 6, 8];

export const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

const MARKDOWN_FENCE_OPEN = "```markdown\n";

/**
 * Collect the content of every Text Display in a payload, in walk order.
 */
export function collectTextDisplays(value: unknown): string[] {
  const contents: string[] = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const child of current) visit(child);
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    if (record.type === ComponentType.TextDisplay && typeof record.content === "string") {
      contents.push(record.content);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return contents;
}

/**
 * Assert a panel payload fits Discord's Components V2 limits, carries no lone surrogate, and keeps
 * user text inside a markdown fence from forming an adjacent backtick pair that could close it.
 */
export function expectSafePanelPayload(payload: ComponentsV2MessagePayload, label: string): void {
  const result = validateComponentsV2MessageLimits(payload);
  expect(result.valid, `${label} violations: ${JSON.stringify(result.violations)}`).toBe(true);
  for (const content of collectTextDisplays(payload)) {
    expect(LONE_SURROGATE.test(content), `${label} contains a lone surrogate`).toBe(false);
    const fenceStart = content.indexOf(MARKDOWN_FENCE_OPEN);
    if (fenceStart === -1) continue;
    const bodyStart = fenceStart + MARKDOWN_FENCE_OPEN.length;
    const closingFence = content.lastIndexOf("\n```");
    if (closingFence <= bodyStart) continue;
    expect(content.slice(bodyStart, closingFence), `${label} has an adjacent backtick in a fence`).not.toMatch(/``/u);
  }
}
