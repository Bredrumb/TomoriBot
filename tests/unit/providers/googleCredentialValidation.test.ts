import { describe, expect, it } from "bun:test";
import type { GoogleGenAI, ListModelsParameters, Model, Pager } from "@google/genai";
import { validateGoogleModelsEndpoint } from "@/providers/google/googleCredentialValidation";

describe("validateGoogleModelsEndpoint", () => {
  it("checks the authenticated base-model listing without generating content", async () => {
    const calls: unknown[] = [];
    // The check awaits the listing and discards the page, so an empty stand-in pins the request only.
    const client = {
      models: {
        list: async (params?: ListModelsParameters): Promise<Pager<Model>> => {
          calls.push(params);
          return {} as Pager<Model>;
        },
      },
    } as Pick<GoogleGenAI, "models">;

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
        list: async (): Promise<Pager<Model>> => {
          throw expectedError;
        },
      },
    } as Pick<GoogleGenAI, "models">;

    expect(validateGoogleModelsEndpoint(client)).rejects.toBe(expectedError);
  });
});
