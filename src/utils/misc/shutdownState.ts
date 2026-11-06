let draining = false;

export function isDraining(): boolean {
  return draining;
}

export function beginDrain(): void {
  draining = true;
}
