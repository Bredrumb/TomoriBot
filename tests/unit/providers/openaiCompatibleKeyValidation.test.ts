import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DeepseekProvider } from "@/providers/deepseek/deepseekProvider";
import { NvidiaProvider } from "@/providers/nvidia/nvidiaProvider";
import { ZaiProvider } from "@/providers/zai/zaiProvider";
import { ZaicodingProvider } from "@/providers/zaicoding/zaicodingProvider";
import { log } from "@/utils/misc/logger";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const API_KEY = "synthetic-key-validation-key";

describe("OpenAI-compatible API key validation failures", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let errorSpy: ReturnType<typeof spyOn<typeof log, "error">>;

  beforeEach(() => {
    errorSpy = spyOn(log, "error").mockResolvedValue(undefined);
    spies.push(
      errorSpy,
      spyOn(log, "warn").mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("keeps a rejected or unfunded key out of error logs while still logging a malformed request", async () => {
    const failures: string[] = [];
    for (const provider of [new DeepseekProvider(), new NvidiaProvider(), new ZaiProvider(), new ZaicodingProvider()]) {
      const name = provider.getInfo().name;
      const cases: Array<[status: number, message: string, errorLogs: number]> = [
        [401, "Authentication Fails, Your api key is invalid", 0],
        ...(name === "nvidia"
          ? []
          : ([
              [402, "Insufficient Balance", 0],
              [400, "Unrecognized request argument supplied: max_tokens", 1],
            ] as Array<[number, string, number]>)),
      ];
      for (const [status, message, errorLogs] of cases) {
        errorSpy.mockClear();
        const fetchSpy = stubGlobalFetch(() => Response.json({ error: { message } }, { status }));
        try {
          const result = await provider.validateApiKey(API_KEY);
          if (result.valid) failures.push(`${name} ${status}: reported valid`);
          if (errorSpy.mock.calls.length !== errorLogs) {
            failures.push(`${name} ${status}: ${errorSpy.mock.calls.length} error logs, expected ${errorLogs}`);
          }
        } finally {
          fetchSpy.mockRestore();
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
