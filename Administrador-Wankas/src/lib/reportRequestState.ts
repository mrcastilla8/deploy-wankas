export class ReportRequestGate {
  private generation = 0;

  begin(): number { return ++this.generation; }
  invalidate(): void { this.generation += 1; }
  isCurrent(generation: number): boolean { return generation === this.generation; }
}

export function canExportReport(loaded: boolean, loading: boolean): boolean {
  return loaded && !loading;
}
