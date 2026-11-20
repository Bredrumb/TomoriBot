export type ScanLanguage =
  | "typescript"
  | "python"
  | "shell"
  | "powershell"
  | "dockerfile"
  | "compose"
  | "terraform"
  | "workflow";

// Only runtime, tooling, and infra roles keep a variable alive, so variables read solely in test or inactive code
// remain removal candidates.
export type ConsumerRole = "runtime" | "tooling" | "infra" | "test" | "inactive";

// Members are ordered by scanner trust, and literal-reference only blocks a dead verdict without proving a read since
// the name just appeared as a string.
export type ReadKind =
  | "direct"
  | "helper"
  | "constant"
  | "interpolation"
  | "external-image"
  | "dynamic-pattern"
  | "literal-reference";

export type DeclarationLayer =
  | "required-example"
  | "optional-example"
  | "compose-environment"
  | "dockerfile-env"
  | "dockerfile-arg"
  | "terraform-env"
  | "workflow-env";

export type Confidence = "high" | "medium" | "low";

export type ClassificationCandidate =
  | "deployment"
  | "runtime-preference"
  | "algorithmic-invariant"
  | "dead"
  | "undecided";

export interface SourceFile {
  path: string;
  text: string;
  origin?: string;
}

export type Fallback = { value: string } | { unrecoverable: string };

export interface Location {
  file: string;
  line: number;
  origin?: string;
}

export interface DeclarationSite extends Location {
  name: string;
  layer: DeclarationLayer;
  value?: string;
  commentDefault?: string;
  section?: string;
  tier?: string;
  service?: string;
  interpolates?: string[];
}

export interface ConsumerSite extends Location {
  name: string;
  language: ScanLanguage;
  role: ConsumerRole;
  kind: ReadKind;
  helper?: string;
  fallback?: Fallback;
}

export interface DynamicPatternSite extends Location {
  prefix: string;
  suffix: string;
  language: ScanLanguage;
  role: ConsumerRole;
}

export interface UnresolvedReadSite extends Location {
  language: ScanLanguage;
  role: ConsumerRole;
  expression: string;
  registeredReason?: string;
}

export interface AliasSite extends Location {
  names: string[];
  language: ScanLanguage;
}

export interface ScanResult {
  consumers: ConsumerSite[];
  declarations: DeclarationSite[];
  dynamicPatterns: DynamicPatternSite[];
  unresolved: UnresolvedReadSite[];
  aliases: AliasSite[];
  parseFailures: Location[];
}

export interface UnavailableSurface {
  surface: string;
  reason: string;
}

// liveEnvKeys stores only variable names because the doctor must never read or store live .env values.
export interface EnvDoctorInput {
  files: SourceFile[];
  liveEnvKeys: string[] | null;
  liveEnvStatus: string;
  unavailable: UnavailableSurface[];
  releaseSource: string | null;
}

export interface DefaultSite extends Location {
  value: string;
  source: "example-value" | "example-comment" | "code";
}

export interface Classification {
  candidate: ClassificationCandidate;
  confidence: Confidence;
  reasons: string[];
}

export interface VariableReport {
  name: string;
  secret: boolean;
  declarations: DeclarationSite[];
  consumers: ConsumerSite[];
  dynamicMatches: DynamicPatternSite[];
  documentedDefaults: DefaultSite[];
  codeFallbacks: DefaultSite[];
  unrecoverableFallbacks: (Location & { expression: string })[];
  aliasGroups: string[][];
  docsMentions: string[];
  exception?: string;
  classification: Classification;
}

export interface ConflictingDefault {
  name: string;
  values: { value: string; sites: DefaultSite[] }[];
}

export interface EnvDoctorReport {
  scanned: Record<string, number>;
  releaseSource: string | null;
  platformNamesIgnored: number;
  variables: VariableReport[];
  diagnostics: {
    declaredUnread: string[];
    readUndocumented: string[];
    conflictingDefaults: ConflictingDefault[];
    aliasGroups: { names: string[]; sites: Location[] }[];
    liveEnvUnconsumed: string[];
    liveEnvStatus: string;
    unresolvedReads: UnresolvedReadSite[];
    parseFailures: Location[];
    unavailable: UnavailableSurface[];
    exceptionDrift: string[];
  };
}
