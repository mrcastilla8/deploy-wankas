# REC-02 — Pedidos, checkout e inventario transaccionales (DEV-2 / TACO)

## 1. Alcance

Este cambio implementa el ámbito de **DEV-2** descrito en el issue
**REC-02**:

- Creación de pedidos atómica y reserva de stock.
- Transiciones de estado atómicas e idempotentes.
- Precios y total calculados desde PostgreSQL.
- Identidad del comprador y autorización derivadas de la sesión y de la base
  de datos, nunca del navegador.
- Integración del e-commerce y de la pantalla administrativa de pedidos.

No se modifican RLS, perfiles, roles, endpoints administrativos ni el helper
`adminFetch`: pertenecen a REC-01 y REC-03.

## 2. Archivos

| Archivo | Responsable | Cambio |
|---|---|---|
| `supabase/migrations/20261110204830_pedidos_stock_atomicos.sql` | DEV-2 | Funciones SQL transaccionales y permisos |
| `supabase/tests/00_fixture.sql` | DEV-2 | Esquema mínimo aislado para pruebas |
| `supabase/tests/01_pedidos_stock.sql` | DEV-2 | Casos SQL de pedidos, stock y permisos |
| `supabase/tests/02_concurrencia.md` | DEV-2 | Prueba manual de dos sesiones |
| `E-commerce-Wankas/src/services/orderService.ts` | DEV-2 | RPC, sin escrituras directas ni `/api/orders` |
| `E-commerce-Wankas/src/app/checkout/page.tsx` | DEV-2 | Envía solo producto/cantidad y usa el total de DB |
| `E-commerce-Wankas/src/context/cart-context.tsx` | DEV-2 | Cantidades enteras y límite por stock |
| `E-commerce-Wankas/src/components/store-selector.tsx` | DEV-2 | Validación real de sede, slot y fecha |
| `Administrador-Wankas/src/app/dashboard/pedidos/page.tsx` | DEV-2 | `PATCH /api/admin/pedidos` vía `adminFetch` |
| `docs/rec-02-pedidos-stock.md` | DEV-2 | Esta documentación |

## 3. Contratos SQL

### 3.1. `place_order_atomic`

```sql
place_order_atomic(
  location_id uuid,
  pickup_date timestamptz,
  notes text,
  items jsonb
) returns table (
  order_id uuid,
  total_price numeric,
  status text
)
```

`items`:

```json
[
  { "product_id": "uuid", "quantity": 2 }
]
```

Reglas:

- `auth.uid()` obligatorio y perfil existente.
- El comprador es `auth.uid()`; se ignora cualquier `user_id` del cliente.
- Solo se leen `product_id` y `quantity`; se ignoran `price`, `total_price` y
  cualquier otro campo.
- Cantidades enteras, mayores que cero y no mayores al stock.
- Duplicados del mismo producto se agregan.
- Bloqueo determinista por `product_id` para evitar deadlocks.
- Total: `round(sum(products.price * cantidad), 2)`.
- Stock se reserva al crear.
- Todo ocurre en una transacción: si falla algo, no queda pedido ni stock
  parcial.

### 3.2. `transition_order_atomic`

```sql
transition_order_atomic(
  order_id uuid,
  new_status text
) returns public.order_transition_result  -- (order_id uuid, status text)
```

Se usa un tipo compuesto porque `RETURNS TABLE(order_id, status)` duplicaría el
nombre del parámetro `order_id`.

Reglas:

- `pending -> completed`: no descuenta stock (ya se reservó al crear).
- `pending -> cancelled`: devuelve stock exactamente una vez.
- `completed` y `cancelled` son terminales.
- Repetir la misma transición es idempotente y no mueve stock.
- Bloqueo `FOR UPDATE` del pedido para serializar transiciones concurrentes.

### 3.3. Autorización

| Rol | Crear pedido | Completar | Cancelar |
|---|---|---|---|
| `user` (o `customer`) | Sí | No | Solo su propio pedido pendiente |
| `worker` | Sí | Solo pedidos de su `profiles.location_id` | Solo pedidos de su sede |
| `admin` | Sí | Cualquier pedido | Cualquier pedido |
| `anon` | No | No | No |

La sede del worker se lee de `public.profiles.location_id` (REC-01). Nunca se
acepta `role`, `userId` ni `location_id` enviados por el navegador como prueba.

La restricción de sede se aplica en la misma consulta que bloquea el pedido
(`FOR UPDATE`). Por eso, para un worker, un pedido **inexistente** y uno **fuera
de su sede** producen la misma respuesta (`42501 / SIN_PERMISO`): no se filtra
la existencia del pedido. Un worker sin `location_id` tampoco puede operar
ningún pedido.

## 4. SQLSTATE y hints

| SQLSTATE | Hint | HTTP sugerido (REC-03) | Significado |
|---|---|---|---|
| `28000` | `NO_AUTENTICADO` | 401 | Sin sesión o sin perfil |
| `42501` | `SIN_PERMISO` | 403 | Rol/sede sin autorización |
| `23514` | `STOCK_INSUFICIENTE` | 409 | Stock insuficiente |
| `23514` | `TRANSICION_INVALIDA` | 409 | Estado terminal o transición no permitida |
| `22023` | `ITEM_INVALIDO` | 400 | Item o cantidad inválida |
| `22023` | `PRODUCTO_INVALIDO` | 400 | Producto inexistente |
| `22023` | `SEDE_INVALIDA` | 400 | Sede inexistente |
| `22023` | `FECHA_INVALIDA` | 400 | Fecha de recojo pasada |
| `22023` | `NOTAS_INVALIDAS` | 400 | Notas demasiado largas |
| `22023` | `PEDIDO_NO_ENCONTRADO` | 400/404 | Pedido inexistente |
| `22P02` | — | 400 | UUID con formato inválido |

> REC-03 debe llamar a `transition_order_atomic` con el **access token del
> usuario**, no con `service_role`. Con `service_role`, `auth.uid()` es nulo y la
> función responde `28000`.

## 5. Orden de aplicación

1. Migración de **REC-01** (crea/verifica `public.profiles.location_id`, roles y
   vínculo con `auth.users`).
2. Migración de **REC-02**:
   `supabase/migrations/20261110204830_pedidos_stock_atomicos.sql`.
   Su timestamp es posterior a `20261110204825_rec01_integridad_historial.sql`,
   por lo que respeta el orden de REC-01.
3. Migraciones de **REC-03** (helper `adminFetch` y `PATCH /api/admin/pedidos`).

La migración de REC-02 falla de forma explícita si falta
`public.profiles.location_id`.

## 6. Pruebas SQL

### 6.1. Estado de ejecución

**Ejecutadas** en un PostgreSQL 18.3 local y desechable (clúster temporal en
`127.0.0.1:61001`), con `00_fixture.sql`, la migración de REC-02 y
`01_pedidos_stock.sql`. Se ejecutaron T1–T21 y la prueba de concurrencia con dos
sesiones reales. El detalle y la salida verificable están en
`docs/rec-02-evidencias.md`.

No se aplicó SQL a producción ni al proyecto Supabase real.

### 6.2. Opción A — PostgreSQL local con `psql`

```bash
createdb wankas_rec02_test

psql "postgresql://postgres:postgres@localhost:5432/wankas_rec02_test" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/00_fixture.sql

psql "postgresql://postgres:postgres@localhost:5432/wankas_rec02_test" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261110204830_pedidos_stock_atomicos.sql

psql "postgresql://postgres:postgres@localhost:5432/wankas_rec02_test" \
  -v ON_ERROR_STOP=1 \
  -f supabase/tests/01_pedidos_stock.sql
```

### 6.3. Opción B — Supabase local

```bash
npx supabase start

# Aplicar fixture y migración al contenedor local (verificar el puerto real).
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/tests/00_fixture.sql

psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261110204830_pedidos_stock_atomicos.sql

psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/tests/01_pedidos_stock.sql
```

> `00_fixture.sql` es **solo para pruebas aisladas**. No aplicarlo al proyecto
> real: crea/reemplaza `auth.uid()` y tablas mínimas.

### 6.4. Casos cubiertos por `01_pedidos_stock.sql`

| Caso | Resultado esperado |
|---|---|
| T1 compra 2 con stock 10 | stock 8, estado `pending`, total 9.00 desde DB |
| T2 completar | estado `completed`, stock sigue 8 |
| T3 cancelar completado | rechazado `23514` |
| T4 cancelar pendiente | stock 10; repetir no restaura más |
| T5 completar cancelado | rechazado `23514` |
| T6 stock insuficiente | rechazado `23514`, stock intacto |
| T7 cantidad 0/negativa/fraccionaria/vacía | rechazado `22023` |
| T7 cantidad mayor al stock | rechazado `23514` |
| T8 producto inexistente | rechazado `22023` |
| T9 fecha pasada | rechazado `22023` |
| T10 sin sesión | rechazado `28000` |
| T11 cliente completa su pedido | rechazado `42501` |
| T12 cliente cancela pedido ajeno | rechazado `42501` |
| T13 worker de otra sede | rechazado `42501`; worker correcto sí puede |
| T14 admin cualquier sede | permitido |
| T15 fallo simulado en `order_items` | sin pedido ni stock parcial |
| T16 items duplicados | agregados en una sola fila |
| T17 `price`/`total_price`/`user_id` manipulados | ignorados; total y comprador de DB |
| T18 permisos | `authenticated` sí, `anon` no |
| T19 worker + pedido inexistente | rechazado `42501` (no filtra existencia) |
| T20 admin + pedido inexistente | rechazado `22023` (regresión) |
| T21 worker sin sede | rechazado `42501` |

### 6.5. Concurrencia

Se ejecutó con dos sesiones `psql` reales sobre la última unidad (stock 1) y el
resultado quedó en `docs/rec-02-evidencias.md`: solo una reserva, la otra recibe
`23514 / STOCK_INSUFICIENTE`, el stock final es 0 y no quedan pedidos ni items de
la compra rechazada. El procedimiento manual sigue en
`supabase/tests/02_concurrencia.md`.

## 7. Cambios de frontend

### E-commerce

- `orderService.ts` usa exclusivamente `supabase.rpc(...)`.
- Ya no escribe `orders`, `order_items` ni `products` desde el navegador.
- Ya no depende de `/api/orders`.
- `getUserOrders` y `cancelOrder` conservan su firma para no editar
  `profile/page.tsx` (propiedad de REC-03), pero ignoran el `userId` recibido y
  usan `supabase.auth.getUser()`.
- `getUserOrders` propaga el error si falla la consulta de `order_items`; solo
  devuelve `items: []` cuando la consulta fue exitosa y no encontró filas.
- El checkout envía `{ product_id, quantity }` y muestra el total devuelto por
  PostgreSQL.
- El carrito rechaza cantidades no enteras, cero, negativas o superiores al
  stock local, y sanea `localStorage` al rehidratar.
- El selector de recojo valida slot, fecha y hora antes de emitir la selección.

### Administrador

- `dashboard/pedidos/page.tsx` ya no importa `createClient()` ni escribe
  `orders`/`products`.
- `GET` y `PATCH` usan `adminFetch`; el `PATCH` envía
  `{ order_id, new_status }`.
- Solo se ofrecen transiciones desde `pending`.
- Se manejan 401, 403, 409 y otros errores; no se convierten en listas vacías.
- La sesión se revalida con `adminFetch` antes de pintar pedidos: la caché de
  pedidos no se muestra sin esa comprobación. Ante 401/403 se limpian pedidos,
  ubicaciones y `adminCache`.
- Cada solicitud lleva un identificador de secuencia y las respuestas pendientes
  de una sesión anterior se descartan; al cambiar de usuario se limpia el estado.

## 8. Coordinación pendiente

- **REC-01**: `public.profiles.location_id` debe existir antes de aplicar esta
  migración. La asignación es la fuente de verdad para autorizar workers.
- **REC-03**: ya publicó
  `Administrador-Wankas/src/lib/adminFetch.ts` en la rama
  `fix/wankas-admin-seguridad`, con la firma
  `adminFetch(path: string, init?: RequestInit): Promise<Response>`; es
  compatible con la pantalla de pedidos. Falta que esa rama llegue a `main`
  para que el build de admin quede verde. Este PR no incluye el helper porque
  es propiedad de DEV-3.
- **REC-03**: el `GET /api/admin/pedidos` debe dejar de confiar en
  `?role=` y `?location_id=` enviados por el navegador y derivar rol y sede de
  la sesión en el servidor. La pantalla de pedidos ya no envía esos parámetros:
  si REC-03 no actualiza el `GET`, un worker podría recibir el listado completo.
- **REC-03**: el `PATCH /api/admin/pedidos` debe invocar
  `transition_order_atomic` con el access token del usuario y responder
  `{ order_id, new_status }`. Si usa `createAdminClient()`/`service_role`,
  `auth.uid()` será nulo y la función devolverá `28000`.
- **REC-03**: debe deshabilitar la caché privada de
  `E-commerce-Wankas/src/app/api/orders/route.ts` y adaptar
  `profile/page.tsx` si corresponde. `orderService.ts` ya no usa ese endpoint.

## 9. Riesgos y limitaciones

- Las pruebas SQL se ejecutaron en un PostgreSQL 18.3 local y desechable; la
  evidencia está en `docs/rec-02-evidencias.md`. No se ejecutaron contra el
  proyecto Supabase real.
- La migración asume el esquema del README (`orders`, `order_items`,
  `products`, `locations`, `profiles`). Se inspeccionó el proyecto real por
  PostgREST: las tablas y tipos coinciden, pero **`profiles.location_id` aún no
  existe** (`42703`), por lo que la migración falla en su precondición hasta
  que REC-01 lo agregue.
- El proyecto real usa `role = 'user'` para los clientes (25 usuarios), no
  `'customer'`. La migración acepta `'user'` y `'customer'` como alias.
- Las funciones `place_order_atomic` y `transition_order_atomic` todavía no
  existen en el proyecto real; solo `is_admin` e `is_admin_or_worker`.
- El build de `Administrador-Wankas` en Vercel queda rojo hasta que la rama
  `fix/wankas-admin-seguridad` (que ya contiene `src/lib/adminFetch.ts`) se
  integre en `main`. No se crea ese archivo aquí porque es propiedad de DEV-3.
- La integración administrativa queda **Draft** hasta que REC-03 publique el
  endpoint y `adminFetch` llegue a `main`.
- La autorización de workers depende de REC-01; sin `profiles.location_id` la
  migración no se aplica.
- Si REC-01 elimina `order_items` en cascada al borrar un producto, el stock de
  pedidos históricos no podría restaurarse. Es una decisión de esquema de
  REC-01.
- El carrito usa `products.stock` como cota local; la autoridad final sigue
  siendo PostgreSQL.
