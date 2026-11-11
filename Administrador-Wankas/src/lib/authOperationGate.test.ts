import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthOperationGate } from './authOperationGate'
import { adminCache } from './adminCache'

test('SIGN_IN de B impide que una hidratación inicial atrasada publique A', async () => {
  const gate = new AuthOperationGate()
  const initialSessionA = gate.begin()
  let resolveA!: (value: string) => void
  const delayedProfileA = new Promise<string>(resolve => { resolveA = resolve })
  const signedInB = gate.begin()
  let visibleUser = ''
  assert.equal(gate.publishIfCurrent(signedInB, () => { visibleUser = 'B' }), true)
  resolveA('A')
  const profileA = await delayedProfileA
  assert.equal(gate.publishIfCurrent(initialSessionA, () => { visibleUser = profileA }), false)
  assert.equal(visibleUser, 'B')
})

test('logout invalida un login que todavía espera respuesta', async () => {
  const gate = new AuthOperationGate()
  const pendingLogin = gate.begin()
  let resolveLogin!: (value: string) => void
  const delayedLogin = new Promise<string>(resolve => { resolveLogin = resolve })
  const logout = gate.begin()
  resolveLogin('usuario-login')
  const userId = await delayedLogin
  let visibleUser: string | null = null
  assert.equal(gate.publishIfCurrent(logout, () => { visibleUser = null }), true)
  assert.equal(gate.publishIfCurrent(pendingLogin, () => { visibleUser = userId }), false)
  assert.equal(visibleUser, null)
})

test('renovación de token conserva identidad y permite una nueva hidratación vigente', () => {
  const gate = new AuthOperationGate()
  adminCache.setIdentity('auth-renewal:admin:')
  adminCache.set('catalogo', ['sesión vigente'])
  const previousHydration = gate.begin()
  const renewalHydration = gate.begin()
  adminCache.setIdentity('auth-renewal:admin:')
  assert.equal(gate.isCurrent(previousHydration), false)
  assert.equal(gate.isCurrent(renewalHydration), true)
  assert.deepEqual(adminCache.get('catalogo'), ['sesión vigente'])
})

test('sesión nula invalida una hidratación anterior', () => {
  const gate = new AuthOperationGate()
  const previousSession = gate.begin()
  const noSession = gate.begin()
  let visibleUser: string | null = 'anterior'
  assert.equal(gate.publishIfCurrent(noSession, () => { visibleUser = null }), true)
  assert.equal(gate.publishIfCurrent(previousSession, () => { visibleUser = 'obsoleto' }), false)
  assert.equal(visibleUser, null)
})

test('desmontar el proveedor impide publicar respuestas pendientes', () => {
  const gate = new AuthOperationGate()
  const pending = gate.begin()
  gate.deactivate()
  let published = false
  assert.equal(gate.publishIfCurrent(pending, () => { published = true }), false)
  assert.equal(published, false)
  gate.activate()
  assert.equal(gate.publishIfCurrent(pending, () => { published = true }), false)
  assert.equal(published, false)
})
