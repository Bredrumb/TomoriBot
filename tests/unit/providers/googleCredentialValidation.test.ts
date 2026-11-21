import { describe, expect, it } from "bun:test";
import type {
  CountTokensParameters,
  CountTokensResponse,
  GoogleGenAI,
  ListModelsParameters,
  Model,
  Pager,
} from "@google/genai";
import {
  validateGoogleModelsEndpoint,
  validateVertexExpressEndpoint,
} from "@/providers/google/googleCredentialValidation";

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

describe("validateVertexExpressEndpoint", () => {
  it("validates Vertex AI Express keys via countTokens instead of the publisher model listing", async () => {
    const calls: unknown[] = [];
    const client = {
      models: {
        countTokens: async (params: CountTokensParameters): Promise<CountTokensResponse> => {
          calls.push(params);
          return { totalTokens: 1 };
        },
      },
    } as Pick<GoogleGenAI, "models">;

    await validateVertexExpressEndpoint(client, "gemini-3.5-flash-lite");

    expect(calls).toEqual([
      {
        model: "gemini-3.5-flash-lite",
        contents: "test",
      },
    ]);
  });
});
