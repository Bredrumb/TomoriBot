import { describe, expect, it, spyOn } from "bun:test";
import {
  buildAcceptedResult,
  buildPlannerJsonSchema,
  sceneScriptIssues,
  planIdleNudge,
  type PlannerCandidate,
} from "@/modules/natural-nudges/runtime/planner";
import { BUILTIN_IDLE_NUDGES } from "@/modules/natural-nudges/runtime/idleNudges";
import { createPersona } from "../../helpers/fixtures";
import * as modelModule from "@/modules/natural-nudges/runtime/model";

const sceneNudge = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "play_scene.banter");
const soloNudge = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.category === "start_topic");
if (!sceneNudge || !soloNudge) throw new Error("planner nudge fixtures missing");
const candidates: PlannerCandidate[] = [
  { idleNudge: sceneNudge, channelIndices: [0], partners: [{ persona: createPersona(), interests: [] }] },
];
const soloCandidates: PlannerCandidate[] = [{ idleNudge: soloNudge, channelIndices: [1], partners: [] }];
const plan = {
  proceed: true,
  nudge: sceneNudge.key,
  channel: 1,
  topic: "mecha",
  opener_direction: "Pick a fight.",
  agenda: "Win.",
};

function maxMinItems(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const own = "minItems" in node && typeof node.minItems === "number" ? node.minItems : 0;
  return Math.max(own, ...Object.values(node).map(maxMinItems));
}

describe("Play Scene script rules", () => {
  it("accepts a script the lead opens, that alternates, and that gives every speaker a turn", () => {
    expect(sceneScriptIssues([1, 2], 1, 1)).toEqual([]);
    expect(sceneScriptIssues([1, 2, 3, 1], 2, 2)).toEqual([]);
  });

  it("names each broken rule once, so the retry note lists exactly what to fix", () => {
    const rejected: Array<[number[], number, number]> = [
      [[2, 1], 1, 1],
      [[1, 2, 1, 2, 1], 1, 1],
      [[1, 2, 2, 1], 1, 1],
      [[1, 2, 3], 1, 1],
      [[1, 2, 1], 2, 2],
      [[1, 2], 2, 1],
    ];
    for (const [script, agendas, partners] of rejected) {
      expect(sceneScriptIssues(script, agendas, partners)).toHaveLength(1);
    }
  });

  it("turns a broken script into a schema failure, which earns the format retry", () => {
    const accept = buildAcceptedResult(candidates);
    expect(accept.safeParse({ ...plan, script: [1, 2], partner_agendas: ["Lose."] }).success).toBe(true);
    expect(accept.safeParse({ ...plan, script: [2, 1], partner_agendas: ["Lose."] }).success).toBe(false);
  });

  it("sends providers no minItems above 1, which Anthropic's output grammar rejects", () => {
    expect(maxMinItems(buildPlannerJsonSchema(candidates))).toBeLessThanOrEqual(1);
  });
});

describe("nudge and channel selection", () => {
  it("accepts only offered nudges paired with their allowed channels", () => {
    const accept = buildAcceptedResult(soloCandidates);
    const soloPlan = { ...plan, nudge: soloNudge.key, channel: 2 };
    expect(accept.safeParse(soloPlan).success).toBe(true);
    expect(accept.safeParse({ ...soloPlan, nudge: "unknown-nudge" }).success).toBe(false);
    for (const channel of [0, 1, 3]) {
      expect(accept.safeParse({ ...soloPlan, channel }).success).toBe(false);
    }
    expect(accept.safeParse({ proceed: false, nudge: "ignored" }).data).toEqual({ proceed: false });
  });

  it("requires scripts for scenes and rejects scripts for other categories", () => {
    const accept = buildAcceptedResult(candidates);
    expect(accept.safeParse({ ...plan, script: [], partner_agendas: [] }).success).toBe(false);
    expect(accept.safeParse({ ...plan, script: [1, 2, 3], partner_agendas: ["Lose.", "Watch."] }).success).toBe(false);
    const soloOnly = buildAcceptedResult(soloCandidates);
    expect(soloOnly.safeParse({ ...plan, nudge: soloNudge.key, channel: 2 }).success).toBe(true);
    expect(
      soloOnly.safeParse({ ...plan, nudge: soloNudge.key, channel: 2, script: [], partner_agendas: [] }).success,
    ).toBe(false);
  });

  it("includes shared scene partner profiles once for multiple offered scene nudges", async () => {
    const otherScene = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "play_scene.asking_for_advice");
    if (!otherScene) throw new Error("scene nudge fixture missing");
    const attribute = "Collects miniature model trains.";
    const persona = createPersona({ persona_id: 5, persona_nickname: "Juno" });
    const partners = [{ persona: createPersona({ persona_id: 6, attribute_list: [attribute] }), interests: [] }];
    const prompts: string[] = [];
    const resolve = spyOn(modelModule, "resolveNudgeModel").mockResolvedValue({
      kind: "ready",
      resolved: {
        state: persona,
        apiKey: "fixture-key",
        capability: {
          callStructuredJSON: async (request, _schema, accepted) => {
            prompts.push(request.userPrompt);
            return { success: true, data: accepted.parse({ proceed: false }) };
          },
        },
      },
    });
    const target = spyOn(modelModule, "resolveStructuredCallTarget").mockResolvedValue({
      model: "fixture-model",
      endpointUrl: undefined,
      maxOutputTokens: 1000,
    });
    try {
      const outcome = await planIdleNudge({
        persona,
        interests: [],
        plannerModel: { llmId: 1, slot: "nudge-planner" },
        target: null,
        candidates: [candidates[0].idleNudge, otherScene].map((idleNudge) => ({
          idleNudge,
          channelIndices: [0],
          partners,
        })),
        channels: [{ name: "general", description: null, transcript: "" }],
      });
      expect(outcome.status).toBe("declined");
      expect(prompts).toHaveLength(1);
      expect(prompts[0].split(attribute).length - 1).toBe(1);
    } finally {
      resolve.mockRestore();
      target.mockRestore();
    }
  });
});
