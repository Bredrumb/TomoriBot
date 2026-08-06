import { describe, expect, it } from "bun:test";
import { validateGoogleModelsEndpoint } from "@/providers/google/googleCredentialValidation";

describe("validateGoogleModelsEndpoint", () => {
  it("checks the authenticated base-model listing without generating content", async () => {
    const calls: unknown[] = [];
    const client = {
      models: {
        list: async (params?: unknown) => {
          calls.push(params);
          return {};
        },
      },
    };

    await validateGoogleModelsEndpoint(client);

    expect(calls).toEqual([
      {
        config: {
          pageSize: 1,
          queryBase: true,
        },
      },
    ]);
  });

  it("propagates endpoint authentication failures", async () => {
    const expectedError = new Error("invalid credential");
    const client = {
      models: {
        list: async () => {
          throw expectedError;
        },
      },
    };

    expect(validateGoogleModelsEndpoint(client)).rejects.toBe(expectedError);
  });
});
