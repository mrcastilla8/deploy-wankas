-- ============================================================================
-- REC-02 / DEV-2 (TACO) — Pruebas SQL de pedidos y stock
--
-- Ejecutar con psql DESPUÉS de:
--   1) 00_fixture.sql
--   2) supabase/migrations/20261110204830_pedidos_stock_atomicos.sql
--
-- El script termina con ROLLBACK para no dejar datos de prueba.
-- ============================================================================

\set ON_ERROR_STOP on
\echo '== REC-02: pruebas de pedidos y stock =='

begin;

create schema if not exists tests;

create or replace function tests.assert_true(cond boolean, label text)
returns void
language plpgsql
as $assert$
begin
  if cond is not true then
    raise exception 'FALLO: %', label;
  end if;
  raise notice 'OK: %', label;
end;
$assert$;

create or replace function tests.assert_eq(actual text, expected text, label text)
returns void
language plpgsql
as $assert$
begin
  if actual is distinct from expected then
    raise exception 'FALLO: % (esperado %, obtenido %)', label, expected, actual;
  end if;
  raise notice 'OK: %', label;
end;
$assert$;

create or replace function tests.expect_error(command text, expected_state text, label text)
returns void
language plpgsql
as $assert$
declare
  v_state text;
begin
  begin
    execute command;
  exception
    when others then
      get stacked diagnostics v_state = returned_sqlstate;
  end;

  if v_state is null then
    raise exception 'FALLO: % (no lanzó error)', label;
  end if;

  if v_state <> expected_state then
    raise exception 'FALLO: % (esperado SQLSTATE %, obtenido %)',
      label, expected_state, v_state;
  end if;

  raise notice 'OK: %', label;
end;
$assert$;

-- ----------------------------------------------------------------------------
-- Datos de prueba
-- ----------------------------------------------------------------------------
insert into public.locations (id, name_es, address) values
  ('10000000-0000-0000-0000-000000000001', 'Sede Central', 'Av. Giráldez 456'),
  ('10000000-0000-0000-0000-000000000002', 'Sede El Tambo', 'Av. Julio C. Tello 123')
on conflict (id) do update
  set name_es = excluded.name_es, address = excluded.address;

-- El proyecto real usa 'user' para clientes; c2 conserva 'customer' para
-- verificar que el alias de compatibilidad tambien funciona.
insert into public.profiles (id, name, email, role, location_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin', 'admin@test.local', 'admin', null),
  ('00000000-0000-0000-0000-0000000000b1', 'Worker Central', 'worker1@test.local', 'worker', '10000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b2', 'Worker Tambo', 'worker2@test.local', 'worker', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b3', 'Worker Sin Sede', 'worker3@test.local', 'worker', null),
  ('00000000-0000-0000-0000-0000000000c1', 'Cliente Uno', 'cliente1@test.local', 'user', null),
  ('00000000-0000-0000-0000-0000000000c2', 'Cliente Dos', 'cliente2@test.local', 'customer', null)
on conflict (id) do update
  set role = excluded.role, location_id = excluded.location_id;

insert into public.products (id, name_es, price, stock) values
  ('20000000-0000-0000-0000-000000000001', 'Arroz Costeño 1kg', 4.50, 10),
  ('20000000-0000-0000-0000-000000000002', 'Fideos Don Vittorio 500g', 3.20, 1),
  ('20000000-0000-0000-0000-000000000003', 'Leche Gloria 400g', 4.20, 0)
on conflict (id) do update
  set price = excluded.price, stock = excluded.stock;

create or replace function tests.reset_data()
returns void
language plpgsql
as $reset$
begin
  delete from public.order_items;
  delete from public.orders;

  update public.products
     set stock = case id
       when '20000000-0000-0000-0000-000000000001'::uuid then 10
       when '20000000-0000-0000-0000-000000000002'::uuid then 1
       when '20000000-0000-0000-0000-000000000003'::uuid then 0
       else stock
     end;

  perform set_config('request.jwt.claim.sub', '', true);
end;
$reset$;

-- ----------------------------------------------------------------------------
-- T1. Compra exitosa: stock 10, compra 2 -> 8; total y precio desde DB.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    'Empaquetar por separado',
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb
  )
\gset t1_

select tests.assert_eq(:'t1_status', 'pending', 'T1 estado inicial pending');
select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '8',
  'T1 stock reservado: 10 - 2 = 8'
);
select tests.assert_eq(
  (select total_price::text from public.orders where id = :'t1_order_id'::uuid),
  '9.00',
  'T1 total calculado desde products.price'
);
select tests.assert_eq(
  (select price_at_purchase::text
     from public.order_items
    where order_id = :'t1_order_id'::uuid
      and product_id = '20000000-0000-0000-0000-000000000001'),
  '4.50',
  'T1 price_at_purchase tomado de la DB'
);
select tests.assert_eq(
  (select user_id::text from public.orders where id = :'t1_order_id'::uuid),
  '00000000-0000-0000-0000-0000000000c1',
  'T1 comprador derivado de auth.uid()'
);

-- ----------------------------------------------------------------------------
-- T2. Completar no vuelve a descontar stock.
-- Completar lo hace admin/worker; el cliente no puede (ver T11).
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select *
  from public.transition_order_atomic(:'t1_order_id'::uuid, 'completed')
\gset t2_

select tests.assert_eq(:'t2_status', 'completed', 'T2 estado completed');
select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '8',
  'T2 completar conserva el stock reservado (8)'
);

-- ----------------------------------------------------------------------------
-- T3. No se puede cancelar un pedido completado.
-- Se ejecuta como cliente para cubrir ese camino de autorizacion.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t1_order_id', 'cancelled'),
  '23514',
  'T3 completed -> cancelled es rechazado'
);

-- ----------------------------------------------------------------------------
-- T4. Cancelar pendiente restaura stock exactamente una vez.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb
  )
\gset t4_

select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '8',
  'T4 stock reservado antes de cancelar'
);

select *
  from public.transition_order_atomic(:'t4_order_id'::uuid, 'cancelled')
\gset t4c_

select tests.assert_eq(:'t4c_status', 'cancelled', 'T4 estado cancelled');
select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '10',
  'T4 cancelar restaura el stock (10)'
);

-- Repetir la cancelación no restaura más stock (idempotencia).
select *
  from public.transition_order_atomic(:'t4_order_id'::uuid, 'cancelled')
\gset t4c2_

select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '10',
  'T4 repetir cancelación no restaura stock otra vez'
);

-- ----------------------------------------------------------------------------
-- T5. No se puede completar un pedido cancelado.
-- Con admin se supera la autorizacion y se llega al estado terminal.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t4_order_id', 'completed'),
  '23514',
  'T5 cancelled -> completed es rechazado'
);

-- ----------------------------------------------------------------------------
-- T6. Stock insuficiente.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000002","quantity":2}]'::jsonb
  )$sql$,
  '23514',
  'T6 stock insuficiente (1 disponible, 2 solicitados)'
);

select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000002'),
  '1',
  'T6 el stock no cambia tras el rechazo'
);

-- ----------------------------------------------------------------------------
-- T7. Cantidades inválidas.
-- ----------------------------------------------------------------------------
select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":0}]'::jsonb
  )$sql$,
  '22023',
  'T7 cantidad cero rechazada'
);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":-2}]'::jsonb
  )$sql$,
  '22023',
  'T7 cantidad negativa rechazada'
);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1.5}]'::jsonb
  )$sql$,
  '22023',
  'T7 cantidad fraccionaria rechazada'
);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":11}]'::jsonb
  )$sql$,
  '23514',
  'T7 cantidad mayor al stock rechazada'
);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[]'::jsonb
  )$sql$,
  '22023',
  'T7 carrito vacío rechazado'
);

-- ----------------------------------------------------------------------------
-- T8. Producto inexistente.
-- ----------------------------------------------------------------------------
select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"29999999-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )$sql$,
  '22023',
  'T8 producto inexistente rechazado'
);

-- ----------------------------------------------------------------------------
-- T9. Fecha de recojo pasada.
-- ----------------------------------------------------------------------------
select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() - interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )$sql$,
  '22023',
  'T9 fecha pasada rechazada'
);

-- ----------------------------------------------------------------------------
-- T10. Sin sesión autenticada.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )$sql$,
  '28000',
  'T10 sin auth.uid() se rechaza'
);

-- ----------------------------------------------------------------------------
-- T11. Cliente no puede completar su propio pedido.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )
\gset t11_

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t11_order_id', 'completed'),
  '42501',
  'T11 user -> completed es rechazado'
);

-- ----------------------------------------------------------------------------
-- T12. Cliente no puede cancelar el pedido de otro cliente.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t11_order_id', 'cancelled'),
  '42501',
  'T12 cliente no cancela pedido ajeno'
);

-- ----------------------------------------------------------------------------
-- T13. Worker solo puede operar pedidos de su sede asignada.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000002'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )
\gset t13_

-- Worker de la sede 1 intenta operar un pedido de la sede 2.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t13_order_id', 'cancelled'),
  '42501',
  'T13 worker de otra sede es rechazado'
);

-- Worker de la sede 2 sí puede.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);

select *
  from public.transition_order_atomic(:'t13_order_id'::uuid, 'cancelled')
\gset t13c_

select tests.assert_eq(:'t13c_status', 'cancelled', 'T13 worker de la sede correcta cancela');

-- ----------------------------------------------------------------------------
-- T14. Admin puede operar pedidos de cualquier sede.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000002'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )
\gset t14_

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select *
  from public.transition_order_atomic(:'t14_order_id'::uuid, 'cancelled')
\gset t14c_

select tests.assert_eq(:'t14c_status', 'cancelled', 'T14 admin cancela pedido de cualquier sede');

-- ----------------------------------------------------------------------------
-- T15. Atomicidad: si falla la inserción de order_items, no queda pedido ni
--      stock descontado.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

create or replace function tests.fail_order_items()
returns trigger
language plpgsql
as $fail$
begin
  raise exception 'fallo simulado en order_items';
end;
$fail$;

drop trigger if exists tests_fail_order_items on public.order_items;
create trigger tests_fail_order_items
before insert on public.order_items
for each row execute function tests.fail_order_items();

select tests.expect_error(
  $sql$select public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb
  )$sql$,
  'P0001',
  'T15 fallo simulado durante la creación'
);

drop trigger if exists tests_fail_order_items on public.order_items;

select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '10',
  'T15 el stock no queda descontado'
);
select tests.assert_eq(
  (select count(*)::text from public.orders),
  '0',
  'T15 no queda pedido parcial'
);
select tests.assert_eq(
  (select count(*)::text from public.order_items),
  '0',
  'T15 no quedan items parciales'
);

-- ----------------------------------------------------------------------------
-- T16. Items duplicados se agregan por producto.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1},
      {"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )
\gset t16_

select tests.assert_eq(
  (select stock::text from public.products where id = '20000000-0000-0000-0000-000000000001'),
  '8',
  'T16 duplicados descuentan el total agregado'
);
select tests.assert_eq(
  (select quantity::text
     from public.order_items
    where order_id = :'t16_order_id'::uuid
      and product_id = '20000000-0000-0000-0000-000000000001'),
  '2',
  'T16 order_items guarda una sola fila con cantidad 2'
);

-- ----------------------------------------------------------------------------
-- T17. Precio/total manipulados en el navegador no afectan el total de DB.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001",
       "quantity":2,
       "price":0.01,
       "total_price":0.01,
       "user_id":"00000000-0000-0000-0000-0000000000c2"}]'::jsonb
  )
\gset t17_

select tests.assert_eq(
  (select total_price::text from public.orders where id = :'t17_order_id'::uuid),
  '9.00',
  'T17 total ignorando price/total_price enviados por el cliente'
);
select tests.assert_eq(
  (select user_id::text from public.orders where id = :'t17_order_id'::uuid),
  '00000000-0000-0000-0000-0000000000c1',
  'T17 user_id ignorando el enviado por el cliente'
);

-- ----------------------------------------------------------------------------
-- T18. Permisos de ejecución.
-- ----------------------------------------------------------------------------
select tests.assert_true(
  has_function_privilege(
    'authenticated',
    'public.place_order_atomic(uuid,timestamptz,text,jsonb)',
    'EXECUTE'
  ),
  'T18 authenticated puede ejecutar place_order_atomic'
);
select tests.assert_true(
  not has_function_privilege(
    'anon',
    'public.place_order_atomic(uuid,timestamptz,text,jsonb)',
    'EXECUTE'
  ),
  'T18 anon NO puede ejecutar place_order_atomic'
);
select tests.assert_true(
  has_function_privilege(
    'authenticated',
    'public.transition_order_atomic(uuid,text)',
    'EXECUTE'
  ),
  'T18 authenticated puede ejecutar transition_order_atomic'
);
select tests.assert_true(
  not has_function_privilege(
    'anon',
    'public.transition_order_atomic(uuid,text)',
    'EXECUTE'
  ),
  'T18 anon NO puede ejecutar transition_order_atomic'
);

-- ----------------------------------------------------------------------------
-- T19. Worker: pedido inexistente y pedido fuera de su sede son indistinguibles.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);

select tests.expect_error(
  $sql$select public.transition_order_atomic(
    '30000000-0000-0000-0000-000000000099'::uuid, 'cancelled')$sql$,
  '42501',
  'T19 worker con pedido inexistente recibe 42501'
);

-- ----------------------------------------------------------------------------
-- T20. Regresión: admin sigue recibiendo 22023 si el pedido no existe.
-- ----------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select tests.expect_error(
  $sql$select public.transition_order_atomic(
    '30000000-0000-0000-0000-000000000099'::uuid, 'cancelled')$sql$,
  '22023',
  'T20 admin con pedido inexistente recibe 22023'
);

-- ----------------------------------------------------------------------------
-- T21. Worker sin sede asignada no puede operar ningún pedido.
-- ----------------------------------------------------------------------------
select tests.reset_data();
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

select *
  from public.place_order_atomic(
    '10000000-0000-0000-0000-000000000001'::uuid,
    now() + interval '1 day',
    null,
    '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb
  )
\gset t21_

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);

select tests.expect_error(
  format('select public.transition_order_atomic(%L::uuid, %L)', :'t21_order_id', 'cancelled'),
  '42501',
  'T21 worker sin sede es rechazado'
);

\echo '== Todas las pruebas SQL de REC-02 pasaron =='

rollback;
