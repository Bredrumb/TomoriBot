import { afterAll } from "bun:test";

/**
 * Helper for writing leak-safe `mock.module` factories.
 *
 * Bun's `mock.module()` is process-global for the whole test run and is NOT
 * undone by `mock.restore()`. A factory that returns only the exports one file
 * cares about therefore corrupts every test file loaded later in a monolithic
 * `bun test`: missing named exports fail ESM link-time validation (reported
 * against the innocent victim file), and simplified stubs silently replace real
 * behavior that other files assert on.
 *
 * The fix is to always spread a hoisted `import * as real` namespace and
 * override only what the file controls. Object spread alone is not enough when
 * an export is a CLASS INSTANCE or a class used for its statics, because those
 * members live on the prototype and are not own enumerable properties — a
 * spread would silently reproduce the same partial-mock bug one level down.
 * {@link overrideMembers} covers those cases.
 */

interface ModuleMockRegistrar {
  module(specifier: string, factory: () => object): void;
}

interface MockScope {
  isActive(): boolean;
}

/**
 * Registers module mocks whose controlled behavior is active only for the test
 * file that declared them.
 *
 * Bun keeps the mocked exports in its process-wide registry after the file
 * finishes. The returned values therefore remain stable proxies, but switch
 * back to the matching hoisted-real export in this file's `afterAll` hook.
 * This preserves the test's behavioral stubs while making the leaked module
 * harmless to files that run later in the same `bun test` process.
 *
 * Every registered module must have a matching hoisted namespace in
 * `realModules`. Factories should still spread that namespace so newly-added
 * exports remain present and the source-level guard can verify the pattern.
 *
 * @param registrar - Bun's `mock` function, which exposes `mock.module`
 * @param realModules - Hoisted real namespaces keyed by mocked specifier
 * @returns A registrar with the same `module(specifier, factory)` shape
 */
export function createScopedModuleMocker(
  registrar: ModuleMockRegistrar,
  realModules: Readonly<Record<string, object>>,
): ModuleMockRegistrar {
  let active = true;
  const scope: MockScope = {
    isActive: () => active,
  };

  afterAll(() => {
    active = false;
  });

  return {
    module(specifier, factory) {
      const realModule = realModules[specifier];
      if (!realModule) {
        throw new Error(`Missing hoisted real module for scoped mock: ${specifier}`);
      }

      registrar.module(specifier, () => scopeModuleExports(scope, realModule, factory()));
    },
  };
}

function scopeModuleExports(scope: MockScope, realModule: object, mockedModule: object): object {
  const realExports = realModule as Record<string, unknown>;
  const mockedExports = mockedModule as Record<string, unknown>;
  const scopedExports: Record<string, unknown> = { ...realExports };

  for (const [name, mockedValue] of Object.entries(mockedExports)) {
    const realValue = realExports[name];
    scopedExports[name] = realValue === mockedValue ? realValue : scopeExportValue(scope, name, realValue, mockedValue);
  }

  return scopedExports;
}

function scopeExportValue(scope: MockScope, name: string, realValue: unknown, mockedValue: unknown): unknown {
  if (typeof realValue === "function" && typeof mockedValue === "function") {
    return new Proxy(realValue, {
      apply(target, thisArg, args) {
        return Reflect.apply(scope.isActive() ? mockedValue : target, thisArg, args);
      },
      construct(target, args, newTarget) {
        return Reflect.construct(scope.isActive() ? mockedValue : target, args, newTarget);
      },
      get(target, property, receiver) {
        const source = scope.isActive() ? mockedValue : target;
        return Reflect.get(source, property, source === target ? receiver : source);
      },
    });
  }

  if (isObject(realValue) && isObject(mockedValue)) {
    let proxy: object;
    proxy = new Proxy(realValue, {
      get(target, property, receiver) {
        const source = scope.isActive() ? mockedValue : target;
        const value = Reflect.get(source, property, source === target ? receiver : source);
        return typeof value === "function" && requiresBoundReceiver(source) ? value.bind(source) : value;
      },
      set(target, property, value, receiver) {
        const destination = scope.isActive() ? mockedValue : target;
        return Reflect.set(destination, property, value, receiver === proxy ? destination : receiver);
      },
    });
    return proxy;
  }

  throw new Error(
    `Scoped module mock export "${name}" must override a function or object; ` +
      `received ${typeof realValue} -> ${typeof mockedValue}`,
  );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function requiresBoundReceiver(value: object): boolean {
  return (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Date
  );
}

/**
 * Overrides selected members of an object, class instance, or class without
 * discarding the rest of its surface.
 *
 * Strategy is chosen at runtime because a hoisted `import * as real` capture is
 * only guaranteed real relative to files linked BEFORE the capturing file: in a
 * monolithic run an earlier test file may already have replaced a class with a
 * plain object. Branching on the received value keeps this helper correct in
 * both situations instead of throwing `Class extends value ... is not a
 * constructor`.
 *
 * @param real - Genuine member captured from a hoisted `import * as real`
 * @param overrides - Members this test file needs to control
 * @returns A stand-in that answers `overrides` first and delegates everything else
 *
 * @example
 * ```ts
 * import * as realRepositories from "@/utils/db/repositories";
 *
 * mock.module("@/utils/db/repositories", () => ({
 *   ...realRepositories,
 *   userRepository: overrideMembers(realRepositories.userRepository, {
 *     loadByDiscordId: async () => fakeUser,
 *   }),
 * }));
 * ```
 */
export function overrideMembers<TReal extends object, TOverrides extends object>(
  real: TReal,
  overrides: TOverrides,
): TReal & TOverrides {
  // 1. A class (used for its statics, and possibly constructed elsewhere):
  //    subclassing inherits the constructor plus every non-enumerable static,
  //    and `Object.assign` shadows only the listed ones.
  if (typeof real === "function") {
    class Overridden extends (real as unknown as new (...args: never[]) => unknown) {}
    return Object.assign(Overridden, overrides) as unknown as TReal & TOverrides;
  }

  // 2. Anything else (class instance, plain object, namespace): put the real
  //    value on the prototype chain so unlisted members still resolve to it,
  //    then install the overrides as own properties that shadow it.
  return Object.assign(Object.create(real) as TReal, overrides) as TReal & TOverrides;
}
