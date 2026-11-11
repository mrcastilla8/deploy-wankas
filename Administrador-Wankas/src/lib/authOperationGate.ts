/** Vigencia única para toda operación que pueda publicar la sesión autenticada. */
export class AuthOperationGate {
  private generation = 0
  private active = true

  begin(): number { return ++this.generation }
  isCurrent(operation: number): boolean { return this.active && operation === this.generation }
  publishIfCurrent(operation: number, publish: () => void): boolean {
    if (!this.isCurrent(operation)) return false
    publish()
    return true
  }
  invalidate(): void { this.generation += 1 }
  deactivate(): void { this.active = false; this.generation += 1 }
  activate(): void { this.active = true; this.generation += 1 }
}
