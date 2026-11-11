# Prueba de concurrencia — última unidad

Esta prueba requiere **dos sesiones psql simultáneas** contra una base local/aislada
con el fixture y la migración de REC-02 ya aplicados. No se ejecuta desde un solo
script porque necesita demostrar el bloqueo real de filas.

## Preparación

```sql
-- En una tercera sesión o antes de abrir las dos sesiones:
delete from public.order_items;
delete from public.orders;
update public.products set stock = 1
 where id = '20000000-0000-0000-0000-000000000002'; -- Fideos

select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000000c1', false); -- Cliente Uno
```

> El `set_config(..., false)` es de sesión. Si se usa `true`, solo dura la
> transacción y cada `BEGIN` posterior lo pierde. Para esta prueba manual se
> recomienda `false` en cada sesión, o repetir el `set_config` después del `BEGIN`.

## Sesión A

```sql
begin;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb
  );
-- Debe devolver un order_id y dejar stock = 0.
-- NO hacer COMMIT todavía.
```

## Sesión B

```sql
begin;
select set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-0000000000c2', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb
  );
-- Debe quedar BLOQUEADA esperando el lock de la fila del producto.
```

## Cierre

En la **Sesión A**:

```sql
commit;
```

En la **Sesión B**, la llamada desbloquea y debe fallar con:

```
ERROR:  No hay stock suficiente para "Fideos Don Vittorio 500g". Disponible: 0, solicitado: 1
SQLSTATE: 23514
HINT: STOCK_INSUFICIENTE
```

Luego:

```sql
rollback;
```

## Resultado esperado

- Solo **una** de las dos compras reserva la última unidad.
- La otra recibe `23514` / `STOCK_INSUFICIENTE`.
- El stock final es `0`, no `-1`.
- No quedan pedidos ni items de la compra rechazada.
