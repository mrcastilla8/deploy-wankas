import { expect, test } from '@playwright/test'

test('smoke de lectura del administrador sin permitir métodos de escritura', async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT_STORAGE_STATE,
    'Requiere storage state de sesión admin preparado fuera del chat en un entorno aislado.')
  const blockedMethods: string[] = []
  await page.route('**/api/admin/**', async route => {
    const request = route.request()
    if (request.method() !== 'GET') {
      blockedMethods.push(`${request.method()} ${new URL(request.url()).pathname}`)
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'READ_ONLY_SMOKE' }) })
      return
    }
    await route.continue()
  })

  for (const [path, heading] of [
    ['/dashboard/catalogo', 'Gestión de Catálogo'],
    ['/dashboard/ubicaciones', 'Gestión de Ubicaciones'],
    ['/dashboard/informes', 'Informes y Analíticas'],
  ]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
  expect(blockedMethods).toEqual([])
})
