import { auditMockModuleSurfaces } from "./lib/mockModuleSurface";

const { violations, scannedFiles, guardedMocks } = await auditMockModuleSurfaces();

if (violations.length > 0) {
  console.error(`Found ${violations.length} unsafe high-risk module mock(s):`);
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} ` +
        `[${violation.kind}] ${violation.moduleSpecifier}: ${violation.message}`,
    );
  }
  process.exit(1);
}

console.log(`Module mock surface check passed: ${guardedMocks} guarded mock(s) across ${scannedFiles} test file(s).`);
