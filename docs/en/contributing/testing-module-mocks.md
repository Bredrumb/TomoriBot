---
title: "Testing with Bun Module Mocks"
---

Bun's `mock.module()` registry is process-wide. `mock.restore()` restores function
mocks and spies, but it does not restore a replaced module. A partial or behavioral
module mock can therefore corrupt files that run later in a plain `bun test`.

## Required pattern

Capture the real namespace with a static import, spread its full export surface,
and register behavioral replacements through the shared scoped helper:

```ts
import { mock } from "bun:test";
import * as realRepositories from "@/utils/db/repositories";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories": realRepositories,
});

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  userRepository: overrideMembers(realRepositories.userRepository, {
    loadByDiscordId: async () => fakeUser,
  }),
}));
```

`createScopedModuleMocker` keeps the controlled behavior active for the declaring
test file, then delegates leaked exports back to the hoisted real module after its
`afterAll` hook. Use `overrideMembers` for class instances and classes used through
static methods; object spread does not copy prototype members.

For a pure passthrough, a raw factory with only the matching spread is harmless:

```ts
mock.module("@/utils/misc/logger", () => ({ ...realLogger }));
```

Prefer dependency injection or `spyOn(...).mockRestore()` when a test controls only
one function. Do not dynamically import the real module inside the factory, because
that import resolves through Bun's already-mocked registry.

## Validation

Run both test modes and the source guard:

```bash
bun test
bun run test
bun run check-mock-module-surfaces
```

The guard audits curated high-fanout modules under `tests/**/*.test.ts`. It requires
a matching hoisted namespace spread and requires behavioral overrides to use
`createScopedModuleMocker`.
