import 'server-only';

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { AdminPrincipal } from './adminAuth';

type Resource = 'catalogo' | 'ubicaciones' | 'dashboard';
const prefix = 'admin:routes:v3';
const ttlMs = 5 * 60 * 1000;
let redis: Redis | undefined;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return;

  if (!redis || redis.status === 'end') {
    redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => console.warn('Admin route cache Redis connection failed'));
  }
  return redis;
}

function versionKey(resource: Resource) {
  return `${prefix}:${resource}:version`;
}

export async function readAdminRouteCache(
  resource: Resource,
  role: AdminPrincipal['role'],
  load: () => Promise<unknown>,
): Promise<unknown> {
  let cache: Redis | undefined;
  let key: string | undefined;
  let expiresAt: number | undefined;
  try {
    cache = getRedis();
    if (cache) {
      const version = versionKey(resource);
      let current = await cache.get(version);
      if (current === null) {
        const initial = randomUUID();
        current = await cache.set(version, initial, 'NX') ? initial : await cache.get(version);
      }
      if (current !== null) {
        key = `${prefix}:${resource}:${role}:${current}`;
        const cached = await cache.get(key);
        if (cached !== null) return JSON.parse(cached);

        // Measure before the DB read using the same clock that expires the key.
        const [seconds, microseconds] = await cache.time();
        expiresAt = Number(seconds) * 1000 + Math.floor(Number(microseconds) / 1000) + ttlMs;
      }
    }
  } catch {
    console.warn('Admin route cache read failed', resource);
  }

  const data = await load();
  if (cache && key && expiresAt !== undefined) {
    try {
      // A slow read or a delayed SET cannot give an old result a fresh TTL.
      await cache.set(key, JSON.stringify(data), 'PXAT', expiresAt);
    } catch {
      console.warn('Admin route cache write failed', resource);
    }
  }
  return data;
}

export async function invalidateAdminRouteCache(resource: Resource) {
  try {
    const cache = getRedis();
    if (!cache) return;

    // In-flight reads can only populate their previous version, which expires by TTL.
    const next = randomUUID();
    if (resource === 'dashboard') {
      await cache.set(versionKey('dashboard'), next);
    } else {
      await cache.mset(versionKey(resource), next, versionKey('dashboard'), next);
    }
  } catch {
    console.warn('Admin route cache invalidation failed', resource);
  }
}
