import { describe, expect, it, spyOn } from "bun:test";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

describe("createScopedModuleMocker", () => {
  it("keeps scoped object exports spyable", () => {
    const realService = {
      load: () => "real",
    };
    const mockedService = {
      load: () => "mocked",
    };
    let factory: (() => object) | undefined;

    const registrar = {
      module(_specifier: string, registeredFactory: () => object) {
        factory = registeredFactory;
      },
    };
    const scopedMock = createScopedModuleMocker(registrar, {
      "@/example/service": { service: realService },
    });

    scopedMock.module("@/example/service", () => ({ service: mockedService }));
    const scopedModule = factory?.() as { service: typeof realService } | undefined;

    expect(scopedModule?.service).toBe(realService);
    const loadSpy = spyOn(realService, "load");
    try {
      expect(scopedModule?.service.load()).toBe("mocked");
      expect(loadSpy).toHaveBeenCalledTimes(1);
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("rejects a relative specifier, which Bun would resolve from the helper", () => {
    const scopedMock = createScopedModuleMocker({ module() {} }, { "./service": {} });
    expect(() => scopedMock.module("./service", () => ({}))).toThrow("is relative");
  });

  describe("after the declaring scope closes", () => {
    const realService = { load: () => "real" };
    const realLoad = realService.load;
    const realFormat = () => "real";
    let scopedModule: { service: typeof realService; format: () => string } | undefined;

    // The mocker registers its restoring `afterAll` on whichever block is collecting, so this nested
    // block stands in for the declaring test file and closes before the sibling test below runs.
    describe("declaring scope", () => {
      const scopedMock = createScopedModuleMocker(
        {
          module(_specifier, registeredFactory) {
            scopedModule = registeredFactory() as typeof scopedModule;
          },
        },
        { "@/example/service": { service: realService, format: realFormat } },
      );
      scopedMock.module("@/example/service", () => ({
        service: { load: () => "mocked" },
        format: () => "mocked",
      }));

      it("serves the mocked behavior", () => {
        expect(scopedModule?.service.load()).toBe("mocked");
        expect(scopedModule?.format()).toBe("mocked");
      });
    });

    it("restores both export kinds and lets a later file's spy land", () => {
      expect(scopedModule?.format()).toBe("real");
      expect(realService.load).toBe(realLoad);

      const loadSpy = spyOn(realService, "load").mockReturnValue("spied");
      try {
        expect(scopedModule?.service.load()).toBe("spied");
        expect(loadSpy).toHaveBeenCalledTimes(1);
      } finally {
        loadSpy.mockRestore();
      }
    });
  });
});
