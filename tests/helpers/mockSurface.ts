import { afterAll, spyOn } from "bun:test";
import { log } from "@/utils/misc/logger";

type LogSurface = typeof log;

// Parameter types use never[] instead of LogSurface[K] because test doubles narrow optional or unknown params that
// strict contravariance would reject.
type LogMemberStubs = { [K in keyof LogSurface]?: (...args: never[]) => unknown };

// Live log singleton is mutated instead of mocking logger because Bun module mocks silently break spyOn on log in
// later test files.
export function stubLogMembers(overrides: LogMemberStubs): void {
  const spies = Object.entries(overrides).map(([member, implementation]) =>
    spyOn(log, member as keyof LogSurface).mockImplementation(implementation as never),
  );

  afterAll(() => {
    for (const spy of spies) spy.mockRestore();
  });
}

interface ModuleMockRegistrar {
  module(specifier: string, factory: () => object): void;
}

interface MockScope {
  isActive(): boolean;
  onClose(restore: () => void): void;
}

// Bun keeps `mock.module` exports process-wide after a file finishes, so `afterAll` neutralizes them while factories
// spread `realModules` for newly added exports.
export function createScopedModuleMocker(
  registrar: ModuleMockRegistrar,
  realModules: Readonly<Record<string, object>>,
): ModuleMockRegistrar {
  let active = true;
  const restores: Array<() => void> = [];
  const scope: MockScope = {
    isActive: () => active,
    onClose: (restore) => restores.push(restore),
  };

  afterAll(() => {
    active = false;
    // Reverse order so nested overrides of the same member unwind correctly.
    for (const restore of restores.reverse()) restore();
    restores.length = 0;
  });

  return {
    module(specifier, factory) {
      if (specifier.startsWith(".")) {
        throw new Error(
          `Scoped mock specifier "${specifier}" is relative: Bun resolves it from this helper, not the test file, ` +
            "so it would mock nothing. Use an @/ alias or an absolute path.",
        );
      }

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
    return scopeObjectExport(scope, realValue, mockedValue);
  }

  throw new Error(
    `Scoped module mock export "${name}" must override a function or object; ` +
      `received ${typeof realValue} -> ${typeof mockedValue}`,
  );
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

// Only the first override captures descriptors here, so a second scope overriding the same member restores the
// genuine descriptor instead of an earlier file's stub.
const pristineMembers = new WeakMap<object, Map<PropertyKey, PropertyDescriptor | undefined>>();

// Object exports must be mutated in place rather than wrapped in a Proxy because Bun's `spyOn` silently records zero
// calls on a Proxy.
function scopeObjectExport(scope: MockScope, realValue: object, mockedValue: object): object {
  const pristine = pristineMembers.get(realValue) ?? new Map<PropertyKey, PropertyDescriptor | undefined>();
  pristineMembers.set(realValue, pristine);

  for (const key of Reflect.ownKeys(mockedValue)) {
    const override = Reflect.getOwnPropertyDescriptor(mockedValue, key);
    if (!override) continue;

    if (!pristine.has(key)) pristine.set(key, Reflect.getOwnPropertyDescriptor(realValue, key));
    const original = pristine.get(key);

    // A frozen or sealed export cannot be overridden; leaving it real is safer
    // than throwing from inside a `mock.module` factory, which runs at link time.
    if (!Reflect.defineProperty(realValue, key, { ...override, configurable: true })) continue;

    scope.onClose(() => {
      if (original) Reflect.defineProperty(realValue, key, original);
      else Reflect.deleteProperty(realValue, key);
    });
  }

  return realValue;
}

// Strategy is chosen at runtime because an earlier test file in a monolithic run may already have replaced a class
// export with a plain object before `import` runs.
export function overrideMembers<TReal extends object, TOverrides extends object>(
  real: TReal,
  overrides: TOverrides,
): TReal & TOverrides {
  // Subclassing inherits the constructor and non-enumerable statics a spread drops,
  // then Object.assign shadows only the listed statics.
  if (typeof real === "function") {
    class Overridden extends (real as unknown as new (...args: never[]) => object) {}
    return Object.assign(Overridden, overrides) as unknown as TReal & TOverrides;
  }

  // Inherit from real via Object.create so unlisted members stay resolvable while overrides shadow them.
  return Object.assign(Object.create(real) as TReal, overrides) as TReal & TOverrides;
}
