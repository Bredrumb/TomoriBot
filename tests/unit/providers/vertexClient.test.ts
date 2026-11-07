import { afterEach, describe, expect, it } from "bun:test";
import {
  isVertexOwnerAllowed,
  parseVertexCompositeKey,
  VERTEX_CONFIG_ERROR_CODE,
  VERTEX_OWNER_NOT_ALLOWED_CODE,
} from "@/providers/vertex/vertexClient";
import { VertexProvider } from "@/providers/vertex/vertexProvider";

const originalAllowedOwners = process.env.VERTEX_ALLOWED_OWNERS;

afterEach(() => {
  if (originalAllowedOwners === undefined) delete process.env.VERTEX_ALLOWED_OWNERS;
  else process.env.VERTEX_ALLOWED_OWNERS = originalAllowedOwners;
});

describe("isVertexOwnerAllowed", () => {
  it("admits every owner while the list is unset", () => {
    delete process.env.VERTEX_ALLOWED_OWNERS;
    expect(isVertexOwnerAllowed("111111111111111111")).toBe(true);
  });

  it("admits only listed owners once the list is set", () => {
    process.env.VERTEX_ALLOWED_OWNERS = "111111111111111111, 222222222222222222";
    expect(isVertexOwnerAllowed("222222222222222222")).toBe(true);
    expect(isVertexOwnerAllowed("333333333333333333")).toBe(false);
    expect(isVertexOwnerAllowed(undefined)).toBe(false);
  });

  it("admits no one when the list is set but empty", () => {
    process.env.VERTEX_ALLOWED_OWNERS = "";
    expect(isVertexOwnerAllowed("111111111111111111")).toBe(false);
  });
});

describe("VertexProvider.validateApiKey", () => {
  it("refuses an unlisted owner before probing Google with the host identity", async () => {
    process.env.VERTEX_ALLOWED_OWNERS = "111111111111111111";
    const result = await new VertexProvider().validateApiKey("someone-elses-project::global", "333333333333333333");
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe(VERTEX_OWNER_NOT_ALLOWED_CODE);
  });

  it("reports a malformed project as a configuration error so setup can explain the format", async () => {
    delete process.env.VERTEX_ALLOWED_OWNERS;
    const result = await new VertexProvider().validateApiKey("my-project/locations/x::global", "111111111111111111");
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe(VERTEX_CONFIG_ERROR_CODE);
  });
});

describe("parseVertexCompositeKey", () => {
  it("accepts Google Cloud location names", () => {
    for (const location of ["global", "us", "us-central1", "europe-west4"]) {
      expect(parseVertexCompositeKey(`my-project::${location}`)).toEqual({ projectId: "my-project", location });
    }
  });

  it("rejects locations that would move the SDK request host and its ADC token", () => {
    const hostAlteringLocations = ["evil.example/x?", "evil.example#", "a@evil.example/", "evil.example:443/"];
    const accepted = hostAlteringLocations.filter((location) => {
      try {
        parseVertexCompositeKey(`my-project::${location}`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([]);
  });

  it("accepts project IDs and project numbers", () => {
    for (const projectId of ["my-project", "tomoribot-vertex", "255946730712"]) {
      expect(parseVertexCompositeKey(`${projectId}::global`).projectId).toBe(projectId);
    }
  });

  it("rejects project IDs that would re-scope the SDK request path and its ADC token", () => {
    const pathAlteringProjects = [
      "../other",
      "my-project/locations/x",
      "my-project?x",
      "my-project#",
      "my%2fproject",
      "a b",
    ];
    const accepted = pathAlteringProjects.filter((projectId) => {
      try {
        parseVertexCompositeKey(`${projectId}::global`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([]);
  });
});
