/** Counts stay in memory, so persist them if restarts ever become frequent enough to matter for a key's daily quota. */
export class NudgeRequestBudget {
  private readonly days = new Map<number, { dayStart: number; used: number }>();

  private used(serverId: number, dayStart: Date): number {
    const day = this.days.get(serverId);
    return day?.dayStart === dayStart.getTime() ? day.used : 0;
  }

  hasRoom(serverId: number, dayStart: Date, cap: number): boolean {
    return this.used(serverId, dayStart) < cap;
  }

  take(serverId: number, dayStart: Date, cap: number): boolean {
    const used = this.used(serverId, dayStart);
    if (used >= cap) return false;
    this.days.set(serverId, { dayStart: dayStart.getTime(), used: used + 1 });
    return true;
  }
}
