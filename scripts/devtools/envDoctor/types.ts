/** Language or file format a scanner understood a site in. */
export type ScanLanguage =
  | "typescript"
  | "python"
  | "shell"
  | "powershell"
  | "dockerfile"
  | "compose"
  | "terraform"
  | "workflow";

/**
 * What a consuming file is for. Only `runtime`, `tooling`, and `infra` keep a variable alive;
 * a name read solely by tests or archived code is still a removal candidate.
 */
export type ConsumerRole = "runtime" | "tooling" | "infra" | "test" | "inactive";

/**
 * How a read was recognized, ordered by how much the scanner trusts it. `literal-reference` means
 * the name only appeared as a string, so it blocks a dead verdict without proving a read.
 */
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

/** A file handed to the scanners. `origin` names the git ref when it did not come from the checkout. */
export interface SourceFile {
  path: string;
  text: string;
  origin?: string;
}

/**
 * A statically recovered default. `value` is the raw literal text; `unrecoverable` carries the
 * expression kind when a fallback exists but cannot be evaluated without running the code.
 */
export type Fallback = { value: string } | { unrecoverable: string };

export interface Location {
  file: string;
  line: number;
  origin?: string;
}

export interface DeclarationSite extends Location {
  name: string;
  layer: DeclarationLayer;
  /** Raw value as written. Absent for bare list entries and interpolated values. */
  value?: string;
  /** Value stated by a `default:` note in the comment block directly above the entry. */
  commentDefault?: string;
  section?: string;
  tier?: string;
  service?: string;
  /** Compose interpolation the value delegates to, such as `POSTGRES_PASSWORD`. */
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

/** A read whose name is built at runtime from a literal prefix and suffix. */
export interface DynamicPatternSite extends Location {
  prefix: string;
  suffix: string;
  language: ScanLanguage;
  role: ConsumerRole;
}

/** A read whose name the scanner could not recover at all. */
export interface UnresolvedReadSite extends Location {
  language: ScanLanguage;
  role: ConsumerRole;
  expression: string;
  /** Reason from the policy registry when this site is known not to hide a repository variable. */
  registeredReason?: string;
}

/** Two or more names that feed one value through a fallback chain. */
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
  /** Files whose parse reported syntax errors, so their reads may be incomplete. */
  parseFailures: Location[];
}

export interface UnavailableSurface {
  surface: string;
  reason: string;
}

/** Scanner input. `liveEnvKeys` holds names only: the doctor never reads a live value. */
export interface EnvDoctorInput {
  files: SourceFile[];
  liveEnvKeys: string[] | null;
  liveEnvStatus: string;
  unavailable: UnavailableSurface[];
  /** Label for release-only files read from a ref, such as `origin/release@c19fa6f`. */
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
