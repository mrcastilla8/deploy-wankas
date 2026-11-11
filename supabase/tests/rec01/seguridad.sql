-- Ejecutar después de datos_previos.sql y las cinco migraciones de REC-01.
begin;
set local plpgsql.check_asserts = on;

create function public.rec01_assert_error(statement text, expected_sqlstate text)
returns void language plpgsql security invoker as $$
begin
  execute statement;
  raise exception 'La operación debía fallar con SQLSTATE %: %', expected_sqlstate, statement;
exception
  when others then
    if sqlstate <> expected_sqlstate then
      raise;
    end if;
end;
$$;

insert into auth.users (id, email, phone, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000006', 'registro@example.test', '555-0106',
        '{"name":"Registro","phone_number":"555-0999","role":"admin","location_id":"30000000-0000-0000-0000-000000000001"}');

do $$
begin
  assert (select count(*) from public.profiles join auth.users using (id)) = 33;
  assert (select count(*) from public.profiles where role = 'customer' and location_id is null) = 27;
  assert (select count(*) from public.profiles where role = 'admin') = 3;
  assert (select count(*) from public.profiles where role = 'worker') = 3;
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-000000000003') = 'worker';
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-000000000004') = 'admin';
  assert exists (
    select 1 from public.profiles
    where id = '00000000-0000-0000-0000-000000000005'
      and name = 'Recuperado' and email = 'sinperfil@example.test' and phone_number = '555-0105'
  );
  assert exists (
    select 1 from public.profiles
    where id = '00000000-0000-0000-0000-000000000006'
      and name = 'Registro' and email = 'registro@example.test' and phone_number = '555-0106'
      and role = 'customer' and location_id is null
  );
  assert (select password_hash from public.profiles
    where id = '00000000-0000-0000-0000-000000000001') = 'dato-sintetico';
end;
$$;

set local role anon;
do $$
begin
  assert (select count(id) from public.products) = 1;
  assert (select count(id) from public.categories) = 1;
  assert (select count(id) from public.locations) = 3;
end;
$$;
select public.rec01_assert_error('update public.products set stock = 0', '42501');
select public.rec01_assert_error('select internal_note from public.products', '42501');
select public.rec01_assert_error('select id from public.profiles', '42501');
select public.rec01_assert_error('select id from public.orders', '42501');
select public.rec01_assert_error('select order_id from public.order_items', '42501');
select public.rec01_assert_error('select public.handle_new_user()', '42501');
select public.rec01_assert_error('select public.is_admin()', '42501');
select public.rec01_assert_error('select public.is_admin_or_worker()', '42501');

set local role authenticated;
select public.rec01_assert_error('select public.handle_new_user()', '42501');
select public.rec01_assert_error('select public.is_admin()', '42501');
select public.rec01_assert_error('select public.is_admin_or_worker()', '42501');
do $$
begin
  assert (select count(id) from public.profiles) = 0;
  assert (select count(*) from public.orders) = 0;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"is_anonymous":true}', true);
do $$
begin
  assert (select count(id) from public.profiles) = 0;
  assert (select count(*) from public.orders) = 0;
  assert (select count(*) from public.order_items) = 0;
  assert (select count(id) from public.products) = 1;
end;
$$;
select set_config('request.jwt.claims', '{"is_anonymous":false}', true);
do $$
begin
  assert (select array_agg(id) from public.profiles) =
    array['00000000-0000-0000-0000-000000000001'::uuid];
  assert (select array_agg(id) from public.orders) =
    array['40000000-0000-0000-0000-000000000001'::uuid];
  assert (select array_agg(order_id) from public.order_items) =
    array['40000000-0000-0000-0000-000000000001'::uuid];
  update public.profiles set name = 'Nombre actualizado', phone_number = '555-0100'
  where id = (select auth.uid());
  assert found;
  update public.profiles set name = 'Nombre incorrecto' where id <> (select auth.uid());
  assert not found;
end;
$$;
select public.rec01_assert_error($sql$update public.profiles set role = 'admin'$sql$, '42501');
select public.rec01_assert_error($sql$update public.profiles set id = gen_random_uuid()$sql$, '42501');
select public.rec01_assert_error('update public.profiles set location_id = null', '42501');
select public.rec01_assert_error('select password_hash from public.profiles', '42501');
select public.rec01_assert_error($sql$insert into public.orders (user_id) values (auth.uid())$sql$, '42501');
select public.rec01_assert_error('delete from public.order_items', '42501');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
begin
  assert (select count(*) from public.orders) = 0;
  assert (select count(*) from public.order_items) = 0;
end;
$$;
select public.rec01_assert_error($sql$update public.profiles set role = 'admin'$sql$, '42501');
select public.rec01_assert_error(
  $sql$update public.profiles set location_id = '30000000-0000-0000-0000-000000000002'$sql$, '42501'
);

-- La capa HTTP verifica el JWT y la autorización antes de usar service_role.
-- Esta prueba cubre los permisos SQL de ambos clientes.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
do $$
begin
  assert (select role from public.profiles) = 'admin';
  assert (select count(*) from public.orders) = 0;
end;
$$;
select public.rec01_assert_error('update public.products set price = 12', '42501');

set local role service_role;
do $$
begin
  assert public.is_admin();
  assert public.is_admin_or_worker();
end;
$$;
update public.profiles set role = 'worker'
where id = '00000000-0000-0000-0000-000000000006';
update public.profiles set location_id = '30000000-0000-0000-0000-000000000001'
where id = '00000000-0000-0000-0000-000000000003' and role = 'worker';
update public.products set price = 12;
do $$
begin
  assert (select count(*) from public.orders) = 2;
  assert (select price from public.products) = 12;
  assert (select role from public.profiles
    where id = '00000000-0000-0000-0000-000000000006') = 'worker';
  assert (select location_id from public.profiles
    where id = '00000000-0000-0000-0000-000000000003') = '30000000-0000-0000-0000-000000000001';
end;
$$;
select public.rec01_assert_error($sql$update public.profiles set role = 'owner'$sql$, '23514');
select public.rec01_assert_error($sql$update public.profiles set location_id = gen_random_uuid()$sql$, '23503');
select public.rec01_assert_error('select password_hash from public.profiles', '42501');
select public.rec01_assert_error('delete from public.orders', '42501');
select public.rec01_assert_error('delete from public.order_items', '42501');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
begin
  assert (select array_agg(id) from public.orders) =
    array['40000000-0000-0000-0000-000000000001'::uuid];
  assert (select array_agg(order_id) from public.order_items) =
    array['40000000-0000-0000-0000-000000000001'::uuid];
  assert (select count(id) from public.profiles) = 1;
end;
$$;
select public.rec01_assert_error($sql$update public.orders set status = 'completed'$sql$, '42501');

set local role service_role;
update public.profiles set location_id = '30000000-0000-0000-0000-000000000003'
where id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
do $$
begin
  assert (select count(*) from public.orders) = 0;
  assert (select count(*) from public.order_items) = 0;
end;
$$;

reset role;
select public.rec01_assert_error(
  $sql$delete from auth.users where id = '00000000-0000-0000-0000-000000000001'$sql$, '23503'
);
select public.rec01_assert_error(
  $sql$delete from public.profiles where id = '00000000-0000-0000-0000-000000000001'$sql$, '23503'
);
select public.rec01_assert_error(
  $sql$delete from public.locations where id = '30000000-0000-0000-0000-000000000001'$sql$, '23503'
);
select public.rec01_assert_error(
  $sql$delete from public.locations where id = '30000000-0000-0000-0000-000000000003'$sql$, '23503'
);
select public.rec01_assert_error('delete from public.products', '23503');
select public.rec01_assert_error('delete from public.orders', '23503');
select public.rec01_assert_error(
  $sql$insert into public.profiles (id, role) values (gen_random_uuid(), 'customer')$sql$, '23503'
);

delete from auth.users where id = '00000000-0000-0000-0000-000000000006';
do $$
begin
  assert not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000006');
  assert (select count(*) from public.orders) = 2;
  assert (select count(*) from public.order_items) = 2;
  assert (select min(price_at_purchase) from public.order_items) = 10;
end;
$$;
rollback;
