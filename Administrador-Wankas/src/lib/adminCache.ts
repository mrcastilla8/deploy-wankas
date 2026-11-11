/**
 * Caché en memoria del lado del cliente.
 * Vive mientras la pestaña del navegador esté abierta.
 * Elimina completamente los fetches redundantes entre secciones del dashboard.
 */

type CacheEntry<T> = {
  data: T;
  fetchedAt: number;
};

// TTL en milisegundos — si el dato tiene más de este tiempo, se revalida en background
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos

const store = new Map<string, CacheEntry<unknown>>();
let identity: string | null = null;
let generation = 0;
let identityGeneration = 0;

export const adminCache = {
  setIdentity(nextIdentity: string | null): number {
    if (identity !== nextIdentity) {
      identity = nextIdentity;
      generation += 1;
      identityGeneration += 1;
      store.clear();
    }
    return generation;
  },

  getGeneration(): number { return generation; },
  isCurrent(requestGeneration: number): boolean { return requestGeneration === generation; },
  getIdentity(): string | null { return identity; },
  hasIdentity(requestIdentity: string | null): boolean { return identity === requestIdentity; },
  getIdentityGeneration(): number { return identityGeneration; },
  isSameIdentityGeneration(requestGeneration: number): boolean { return identityGeneration === requestGeneration; },

  /** Invalida por error de autorización solo si la identidad de la petición sigue activa. */
  invalidateForIdentityGeneration(requestIdentityGeneration: number): boolean {
    if (identityGeneration !== requestIdentityGeneration) return false;
    store.clear();
    generation += 1;
    return true;
  },

  get<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | null {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > ttlMs) {
      store.delete(key);
      return null;
    }
    return entry.data;
  },

  set<T>(key: string, data: T, requestGeneration = generation): void {
    if (requestGeneration !== generation) return;
    store.set(key, { data, fetchedAt: Date.now() });
  },

  invalidate(key: string): void {
    store.delete(key);
  },

  invalidateAll(): void {
    store.clear();
    generation += 1;
  },
};
