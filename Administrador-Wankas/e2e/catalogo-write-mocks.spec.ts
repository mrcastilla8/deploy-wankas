import { expect, test } from '@playwright/test'

const product = {
  id: 'fixture-product', name_es: 'Producto de prueba', description_es: 'Fixture',
  price: 9.5, stock: 7, category_id: 'fixture-category', categories: { name_es: 'Fixture' },
}
const payload = { products: [product], categories: [{ id: 'fixture-category', name_es: 'Fixture' }] }

test('crear y editar catálogo usan API mock; ninguna escritura llega al servidor', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD,
    'Requiere cuenta admin de un proyecto Supabase aislado; no usar Wankas New.')
  const observedWrites: string[] = []
  await page.route('**/api/admin/**', async route => {
    const request = route.request()
    const method = request.method()
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
      return
    }
    observedWrites.push(`${method} ${new URL(request.url()).pathname}`)
    if (new URL(request.url()).pathname !== '/api/admin/catalogo' || !['POST', 'PATCH'].includes(method)) {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'MOCK_ONLY' }) })
      return
    }
    await route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', body: JSON.stringify(product) })
  })

  await page.goto('/')
  await page.getByLabel('Correo Electrónico').fill(process.env.E2E_ADMIN_EMAIL!)
  await page.getByLabel('Contraseña').fill(process.env.E2E_ADMIN_PASSWORD!)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await page.waitForURL('**/dashboard')
  await page.goto('/dashboard/catalogo')
  await expect(page.getByRole('heading', { name: 'Gestión de Catálogo' })).toBeVisible()

  await page.getByRole('button', { name: 'Añadir Producto' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nombre').fill('Producto de prueba')
  await dialog.getByLabel('Descripción').fill('Fixture')
  await dialog.getByLabel('Precio').fill('9.50')
  await dialog.getByLabel('Stock').fill('7')
  await dialog.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Fixture' }).click()
  await dialog.getByRole('button', { name: 'Guardar Producto' }).click()
  await expect.poll(() => observedWrites).toContain('POST /api/admin/catalogo')
  await expect(page.getByText('Producto de prueba').first()).toBeVisible()

  await page.getByRole('button', { name: 'Toggle menu' }).click()
  await page.getByRole('menuitem', { name: 'Editar' }).click()
  const editDialog = page.getByRole('dialog')
  await editDialog.getByLabel('Nombre').fill('Producto editado')
  await editDialog.getByRole('button', { name: 'Guardar Producto' }).click()
  await expect.poll(() => observedWrites).toContain('PATCH /api/admin/catalogo')
  expect(observedWrites.every(write => write.startsWith('POST /api/admin/catalogo') || write.startsWith('PATCH /api/admin/catalogo'))).toBe(true)
})
