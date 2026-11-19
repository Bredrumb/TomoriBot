const CHECKLIST_SNAPSHOT_TTL_MS = 15 * 60_000;

const checklistSnapshots = new Map<string, { values: string[]; expiresAt: number }>();

// Presented entries are snapshotted at modal open so submit updates only those entries and leaves concurrently added
// entries untouched.
export function storeChecklistSnapshot(nonce: string, values: readonly string[]): void {
  const now = Date.now();
  for (const [key, snapshot] of checklistSnapshots) {
    if (snapshot.expiresAt < now) checklistSnapshots.delete(key);
  }
  checklistSnapshots.set(nonce, { values: [...values], expiresAt: now + CHECKLIST_SNAPSHOT_TTL_MS });
}

export function takeChecklistSnapshot(nonce: string): string[] | undefined {
  const snapshot = checklistSnapshots.get(nonce);
  checklistSnapshots.delete(nonce);
  return snapshot && snapshot.expiresAt >= Date.now() ? snapshot.values : undefined;
}
