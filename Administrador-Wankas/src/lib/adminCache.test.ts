import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminCache } from './adminCache';

test('cambio de usuario limpia los datos y rechaza una respuesta tardía', () => {
  adminCache.invalidateAll();
  adminCache.setIdentity('user-a:admin:');
  const requestA = adminCache.getGeneration();
  adminCache.set('catalogo', ['A'], requestA);
  assert.deepEqual(adminCache.get('catalogo'), ['A']);

  adminCache.setIdentity('user-b:admin:');
  assert.equal(adminCache.get('catalogo'), null);
  adminCache.set('catalogo', ['respuesta tardía de A'], requestA);
  assert.equal(adminCache.get('catalogo'), null);
});

test('logout invalida generaciones pendientes', () => {
  adminCache.invalidateAll();
  adminCache.setIdentity('user-a:worker:location-a');
  const pending = adminCache.getGeneration();
  adminCache.set('pedidos', ['A'], pending);
  adminCache.setIdentity(null);
  adminCache.set('pedidos', ['respuesta tras logout'], pending);
  assert.equal(adminCache.get('pedidos'), null);
});

test('renovar token conserva la identidad y variar rol o sede invalida', () => {
  adminCache.invalidateAll();
  const first = adminCache.setIdentity('user-a:worker:location-a');
  adminCache.set('ubicaciones', ['caché de sesión'], first);
  assert.equal(adminCache.setIdentity('user-a:worker:location-a'), first);
  assert.deepEqual(adminCache.get('ubicaciones'), ['caché de sesión']);
  adminCache.setIdentity('user-a:admin:location-a');
  assert.equal(adminCache.get('ubicaciones'), null);
  adminCache.set('ubicaciones', ['admin'], adminCache.getGeneration());
  adminCache.setIdentity('user-a:admin:location-b');
  assert.equal(adminCache.get('ubicaciones'), null);
});
