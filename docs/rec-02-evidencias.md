# REC-02 — Evidencia de ejecución

## Entorno

- **PostgreSQL 18.3** (`x86_64-windows`), clúster temporal desechable en
  `127.0.0.1:61001`, creado con `initdb -A trust`.
- Base de datos: `wankas_rec02`.
- Scripts ejecutados, en este orden:
  1. `supabase/tests/00_fixture.sql`
  2. `supabase/migrations/20261110204830_pedidos_stock_atomicos.sql`
  3. `supabase/tests/01_pedidos_stock.sql`
  4. Concurrencia con dos sesiones `psql` simultáneas.
- **No se conectó ni se aplicó SQL al proyecto Supabase remoto.**

## Resultado global

| Paso | Resultado |
|---|---|
| Fixture aislado | `exit 0` |
| Migración REC-02 | `exit 0` |
| T1–T21 | `exit 0` — `== Todas las pruebas SQL de REC-02 pasaron ==` |
| Concurrencia (2 sesiones) | A confirma; B recibe `23514 / STOCK_INSUFICIENTE`; stock final `0` |

## T1–T21

Salida de `psql` (una línea `NOTICE` por aserción):

```text
OK: T1 price_at_purchase tomado de la DB
OK: T1 comprador derivado de auth.uid()
OK: T2 estado completed
OK: T2 completar conserva el stock reservado (8)
OK: T3 completed -> cancelled es rechazado
OK: T4 stock reservado antes de cancelar
OK: T4 estado cancelled
OK: T4 cancelar restaura el stock (10)
OK: T4 repetir cancelación no restaura stock otra vez
OK: T5 cancelled -> completed es rechazado
OK: T6 stock insuficiente (1 disponible, 2 solicitados)
OK: T6 el stock no cambia tras el rechazo
OK: T7 cantidad cero rechazada
OK: T7 cantidad negativa rechazada
OK: T7 cantidad fraccionaria rechazada
OK: T7 cantidad mayor al stock rechazada
OK: T7 carrito vacío rechazado
OK: T8 producto inexistente rechazado
OK: T9 fecha pasada rechazada
OK: T10 sin auth.uid() se rechaza
OK: T11 user -> completed es rechazado
OK: T12 cliente no cancela pedido ajeno
OK: T13 worker de otra sede es rechazado
OK: T13 worker de la sede correcta cancela
OK: T14 admin cancela pedido de cualquier sede
OK: T15 fallo simulado durante la creación
OK: T15 el stock no queda descontado
OK: T15 no queda pedido parcial
OK: T15 no quedan items parciales
OK: T16 duplicados descuentan el total agregado
OK: T16 order_items guarda una sola fila con cantidad 2
OK: T17 total ignorando price/total_price enviados por el cliente
OK: T17 user_id ignorando el enviado por el cliente
OK: T18 authenticated puede ejecutar place_order_atomic
OK: T18 anon NO puede ejecutar place_order_atomic
OK: T18 authenticated puede ejecutar transition_order_atomic
OK: T18 anon NO puede ejecutar transition_order_atomic
OK: T19 worker con pedido inexistente recibe 42501
OK: T20 admin con pedido inexistente recibe 22023
OK: T21 worker sin sede es rechazado
```

### Negativos de autorización y regresión

| Prueba | Caso | Resultado |
|---|---|---|
| T10 | Sin `auth.uid()` | `28000` |
| T11 | Cliente intenta completar | `42501` |
| T12 | Cliente cancela pedido ajeno | `42501` |
| T13 | Worker de otra sede | `42501` |
| T19 | Worker + pedido inexistente | `42501` (no filtra existencia) |
| T20 | Admin + pedido inexistente | `22023` (regresión) |
| T21 | Worker sin `location_id` | `42501` |

## Concurrencia real

Preparación: `stock = 1` para `Fideos Don Vittorio 500g`, sin pedidos previos.
Se lanzaron dos sesiones `psql` simultáneas; la sesión A mantiene la transacción
abierta 3 segundos después de reservar.

**Sesión A (Cliente Uno):**

```text
BEGIN
 order_id                             | total_price | status
--------------------------------------+-------------+---------
 d2348be7-bb55-4f2e-85de-bbaa9f1c947d |        3.20 | pending
COMMIT
```

**Sesión B (Cliente Dos):**

```text
BEGIN
 pg_sleep 1
ERROR:  23514: No hay stock suficiente para "Fideos Don Vittorio 500g".
        Disponible: 0, solicitado: 1.
HINT:  STOCK_INSUFICIENTE
ROLLBACK
```

**Verificación final:**

```text
 stock_final
-------------
           0

 pedidos
---------
       1

 items
-------
       1
```

Solo una compra reservó la última unidad; la otra no dejó pedido ni items.

## Typecheck

- `E-commerce-Wankas`: `npm run typecheck` → **exit 0**.
- `Administrador-Wankas`: solo quedan los **5 errores preexistentes** de
  `src/components/reports-client.tsx` (tipos de `jspdf`). `adminFetch` es de
  REC-03: se copió de `origin/fix/wankas-admin-seguridad` solo para el typecheck
  local y **no se versiona** en este PR.
