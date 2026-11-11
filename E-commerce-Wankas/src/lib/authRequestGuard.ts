/** Monotonic identity for profile reads; only the newest live request may commit. */
export class AuthRequestGuard {
  private generation = 0;
  private active = true;

  begin(): number { this.active = true; return ++this.generation; }
  isCurrent(generation: number): boolean { return this.active && generation === this.generation; }
  invalidate(): void { this.generation += 1; }
  dispose(): void { this.active = false; this.invalidate(); }
}
