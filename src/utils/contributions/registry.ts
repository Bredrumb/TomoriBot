type ContributionCriticality = "critical" | "optional";

export interface ContributionMeta {
  id: string;
  owner: string;
  source: string;
  order: number;
  criticality: ContributionCriticality;
  after?: readonly string[];
  before?: readonly string[];
}

export interface ContributionDescriptor {
  meta: ContributionMeta;
}

export interface ContributionInventoryItem {
  id: string;
  owner: string;
  source: string;
  order: number;
  criticality: ContributionCriticality;
}

export interface ContributionRegistry<Entry extends ContributionDescriptor> {
  ordered: readonly Entry[];
  inventory: readonly ContributionInventoryItem[];
}

export type ContributionRegistryErrorCode =
  | "invalid_descriptor"
  | "duplicate_id"
  | "unknown_dependency"
  | "dependency_cycle";

export class ContributionRegistryError extends Error {
  constructor(
    readonly code: ContributionRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContributionRegistryError";
  }
}

export interface ContributionExecutionDiagnostic {
  id: string;
  status: "success" | "failed" | "timed_out";
  durationMs: number;
  outputCount: number;
}

export interface ContributionExecutionResult<Value> {
  value: Value | null;
  diagnostic: ContributionExecutionDiagnostic;
}

export function aggregateContributionDiagnostics(
  diagnostics: readonly ContributionExecutionDiagnostic[],
): ContributionExecutionDiagnostic[] {
  const rank = { success: 0, failed: 1, timed_out: 2 } as const;
  const aggregated = new Map<string, ContributionExecutionDiagnostic>();
  for (const diagnostic of diagnostics) {
    const existing = aggregated.get(diagnostic.id);
    if (!existing) {
      aggregated.set(diagnostic.id, { ...diagnostic });
      continue;
    }
    aggregated.set(diagnostic.id, {
      id: diagnostic.id,
      status: rank[diagnostic.status] > rank[existing.status] ? diagnostic.status : existing.status,
      durationMs: existing.durationMs + diagnostic.durationMs,
      outputCount: existing.outputCount + diagnostic.outputCount,
    });
  }
  return [...aggregated.values()];
}

export class ContributionExecutionError extends Error {
  constructor(
    readonly contribution: ContributionInventoryItem,
    readonly diagnostic: ContributionExecutionDiagnostic,
    options?: ErrorOptions,
  ) {
    super(
      `Critical contribution "${contribution.id}" from ${contribution.owner} (${contribution.source}) ${diagnostic.status}`,
      options,
    );
    this.name = "ContributionExecutionError";
  }
}

function normalizeContributionId(id: string): string {
  return id.trim().toLowerCase();
}

function inventoryItem(meta: ContributionMeta): ContributionInventoryItem {
  return {
    id: meta.id,
    owner: meta.owner,
    source: meta.source,
    order: meta.order,
    criticality: meta.criticality,
  };
}

function compareContributions<Entry extends ContributionDescriptor>(left: Entry, right: Entry): number {
  if (left.meta.order !== right.meta.order) return left.meta.order - right.meta.order;
  if (left.meta.id < right.meta.id) return -1;
  if (left.meta.id > right.meta.id) return 1;
  return 0;
}

export function createContributionRegistry<Entry extends ContributionDescriptor>(
  domain: string,
  entries: readonly Entry[],
): ContributionRegistry<Entry> {
  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    const id = normalizeContributionId(entry.meta.id);
    if (!id || !entry.meta.owner.trim() || !entry.meta.source.trim() || !Number.isFinite(entry.meta.order)) {
      throw new ContributionRegistryError(
        "invalid_descriptor",
        `Invalid ${domain} contribution descriptor from ${entry.meta.owner || "unknown owner"} (${entry.meta.source || "unknown source"})`,
      );
    }
    const existing = byId.get(id);
    if (existing) {
      throw new ContributionRegistryError(
        "duplicate_id",
        `Duplicate ${domain} contribution "${id}": ${existing.meta.owner} (${existing.meta.source}) conflicts with ${entry.meta.owner} (${entry.meta.source})`,
      );
    }
    byId.set(id, { ...entry, meta: { ...entry.meta, id } });
  }

  const outgoing = new Map<string, Set<string>>([...byId.keys()].map((id) => [id, new Set()]));
  const indegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  const addEdge = (from: string, to: string, owner: Entry): void => {
    if (!byId.has(from)) {
      throw new ContributionRegistryError(
        "unknown_dependency",
        `${domain} contribution "${owner.meta.id}" from ${owner.meta.owner} (${owner.meta.source}) references unknown dependency "${from}"`,
      );
    }
    if (!byId.has(to)) {
      throw new ContributionRegistryError(
        "unknown_dependency",
        `${domain} contribution "${owner.meta.id}" from ${owner.meta.owner} (${owner.meta.source}) references unknown dependency "${to}"`,
      );
    }
    const targets = outgoing.get(from);
    if (!targets || targets.has(to)) return;
    targets.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const entry of byId.values()) {
    for (const dependency of entry.meta.after ?? []) {
      addEdge(normalizeContributionId(dependency), entry.meta.id, entry);
    }
    for (const dependency of entry.meta.before ?? []) {
      addEdge(entry.meta.id, normalizeContributionId(dependency), entry);
    }
  }

  const ready = [...byId.values()].filter((entry) => indegree.get(entry.meta.id) === 0).sort(compareContributions);
  const ordered: Entry[] = [];
  while (ready.length > 0) {
    const entry = ready.shift();
    if (!entry) break;
    ordered.push(entry);
    for (const target of outgoing.get(entry.meta.id) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) {
        const targetEntry = byId.get(target);
        if (targetEntry) {
          ready.push(targetEntry);
          ready.sort(compareContributions);
        }
      }
    }
  }

  if (ordered.length !== entries.length) {
    const cycleIds = [...indegree.entries()]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
      .sort();
    throw new ContributionRegistryError(
      "dependency_cycle",
      `${domain} contribution dependency cycle: ${cycleIds.join(", ")}`,
    );
  }

  return {
    ordered,
    inventory: ordered.map((entry) => inventoryItem(entry.meta)),
  };
}

export async function executeContribution<Value>(params: {
  descriptor: ContributionDescriptor;
  timeoutMs: number;
  outputCount(value: Value): number;
  run(signal: AbortSignal): Promise<Value>;
}): Promise<ContributionExecutionResult<Value>> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Contribution timed out after ${params.timeoutMs}ms`));
    }, params.timeoutMs);
  });

  try {
    const value = await Promise.race([params.run(controller.signal), timeout]);
    return {
      value,
      diagnostic: {
        id: params.descriptor.meta.id,
        status: "success",
        durationMs: performance.now() - startedAt,
        outputCount: params.outputCount(value),
      },
    };
  } catch (error) {
    const diagnostic: ContributionExecutionDiagnostic = {
      id: params.descriptor.meta.id,
      status: timedOut ? "timed_out" : "failed",
      durationMs: performance.now() - startedAt,
      outputCount: 0,
    };
    if (params.descriptor.meta.criticality === "critical") {
      throw new ContributionExecutionError(inventoryItem(params.descriptor.meta), diagnostic, { cause: error });
    }
    return { value: null, diagnostic };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
