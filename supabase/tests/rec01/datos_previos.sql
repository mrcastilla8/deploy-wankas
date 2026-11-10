-- Estado previo de la prueba de recuperación. Identidades y datos ficticios.
alter table public.products add column internal_note text;
grant all on all tables in schema public to anon, authenticated, service_role;
grant select (password_hash) on public.profiles to public;
grant update (role, id) on public.profiles to authenticated;
alter table public.profiles enable row level security;
create policy profiles_legacy on public.profiles using (true) with check (true);
alter table public.orders enable row level security;
create policy orders_legacy on public.orders using (true) with check (true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'cliente1@example.test', '{"name":"Cliente 1"}'),
  ('00000000-0000-0000-0000-000000000002', 'cliente2@example.test', '{"name":"Cliente 2"}'),
  ('00000000-0000-0000-0000-000000000003', 'worker@example.test', '{"name":"Worker"}'),
  ('00000000-0000-0000-0000-000000000004', 'admin@example.test', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-000000000005', 'sinperfil@example.test', '{"name":"Recuperado","role":"admin"}');

insert into public.profiles (id, name, role, password_hash) values
  ('00000000-0000-0000-0000-000000000001', 'Cliente 1', 'user', 'dato-sintetico'),
  ('00000000-0000-0000-0000-000000000002', 'Cliente 2', 'customer', null),
  ('00000000-0000-0000-0000-000000000003', 'Worker', 'worker', null),
  ('00000000-0000-0000-0000-000000000004', 'Admin', 'admin', null);

create function public.rec01_fixture_legacy_profile() returns trigger
language plpgsql as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'role');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.rec01_fixture_legacy_profile();

insert into public.categories (id, name_es)
values ('10000000-0000-0000-0000-000000000001', 'Categoría de prueba');
insert into public.products (id, category_id, name_es, price, stock)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Producto', 10, 10);
insert into public.locations (id, name_es, address) values
  ('30000000-0000-0000-0000-000000000001', 'Sede 1', 'Dirección de prueba 1'),
  ('30000000-0000-0000-0000-000000000002', 'Sede 2', 'Dirección de prueba 2'),
  ('30000000-0000-0000-0000-000000000003', 'Sede sin pedidos', 'Dirección de prueba 3');
insert into public.orders (id, user_id, location_id, pickup_date, total_price) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001', '2030-01-01T12:00:00Z', 10),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
   '30000000-0000-0000-0000-000000000002', '2030-01-01T12:00:00Z', 10);
insert into public.order_items (order_id, product_id, quantity, price_at_purchase)
select id, '20000000-0000-0000-0000-000000000001', 1, 10 from public.orders;
