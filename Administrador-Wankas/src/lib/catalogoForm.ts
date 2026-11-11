/**
 * Validación del formulario de catálogo (REC-05).
 * Replica las reglas de `/api/admin/catalogo` (REC-03) para avisar antes de enviar:
 * nombre no vacío, precio finito y positivo, categoría obligatoria y, solo al crear,
 * stock entero entre 0 y 2 147 483 647. El servidor sigue siendo quien decide.
 */

export type ProductFormValues = {
  name_es: string
  description_es: string
  price: string
  stock: string
  category_id: string
}

export type ProductChanges = {
  name_es: string
  description_es: string
  price: number
  category_id: string
}

export type NewProduct = ProductChanges & { stock: number }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }

const MAX_STOCK = 2_147_483_647

export function parseProductChanges(form: ProductFormValues): ParseResult<ProductChanges> {
  const name = form.name_es.trim()
  if (!name) return { ok: false, message: 'El nombre es obligatorio.' }

  const priceText = form.price.trim()
  const price = Number(priceText)
  if (!priceText || !Number.isFinite(price) || price <= 0) {
    return { ok: false, message: 'El precio debe ser un número mayor que 0.' }
  }

  if (!form.category_id) return { ok: false, message: 'Selecciona una categoría.' }

  return {
    ok: true,
    value: { name_es: name, description_es: form.description_es, price, category_id: form.category_id },
  }
}

export function parseNewProduct(form: ProductFormValues): ParseResult<NewProduct> {
  const details = parseProductChanges(form)
  if (!details.ok) return details

  const stockText = form.stock.trim()
  const stock = Number(stockText)
  if (!/^\d+$/.test(stockText) || !Number.isSafeInteger(stock) || stock > MAX_STOCK) {
    return { ok: false, message: 'El stock debe ser un número entero mayor o igual a 0.' }
  }

  return { ok: true, value: { ...details.value, stock } }
}
