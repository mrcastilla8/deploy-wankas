import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canExportReport, ReportRequestGate } from './reportRequestState';

test('una respuesta de una sesión anterior no se confirma después de cambiar de identidad', async () => {
  const gate = new ReportRequestGate();
  const oldRequest = gate.begin();
  let resolveOld!: (value: string) => void;
  const response = new Promise<string>((resolve) => { resolveOld = resolve; });
  gate.invalidate();
  const newRequest = gate.begin();
  assert.equal(gate.isCurrent(oldRequest), false);
  assert.equal(gate.isCurrent(newRequest), true);
  resolveOld('datos de A');
  const oldData = await response;
  assert.equal(gate.isCurrent(oldRequest) ? oldData : null, null);
});

test('la exportación queda deshabilitada durante carga o error, y habilitada con datos validados', () => {
  assert.equal(canExportReport(false, true), false);
  assert.equal(canExportReport(false, false), false);
  assert.equal(canExportReport(true, false), true);
  assert.equal(canExportReport(true, true), false);
});
