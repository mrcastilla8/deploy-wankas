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
  ('00000000-0000-0000-0000-000000000005', 'sinperfil@example.test', '{"name":"Recuperado","role":"admin","phone_number":"555-0105"}');

insert into public.profiles (id, name, role, password_hash) values
  ('00000000-0000-0000-0000-000000000001', 'Cliente 1', 'user', 'dato-sintetico'),
  ('00000000-0000-0000-0000-000000000002', 'Cliente 2', 'user', null),
  ('00000000-0000-0000-0000-000000000003', 'Worker', 'worker', null),
  ('00000000-0000-0000-0000-000000000004', 'Admin', 'admin', null);

with identities as (
  insert into auth.users (email)
  select 'historico' || n || '@example.test' from generate_series(1, 27) as n
  returning id, email
)
insert into public.profiles (id, email, role)
select id, email, case
  when email in ('historico24@example.test', 'historico25@example.test') then 'worker'
  when email in ('historico26@example.test', 'historico27@example.test') then 'admin'
  else 'user'
end
from identities;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name, phone_number, role)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name', new.phone, new.raw_user_meta_data ->> 'role');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
create function public.is_admin_or_worker() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin()
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'worker');
$$;
grant execute on function public.handle_new_user(), public.is_admin(), public.is_admin_or_worker()
  to anon, authenticated;
grant execute on function public.is_admin(), public.is_admin_or_worker() to service_role;
create policy orders_legacy_staff on public.orders for select to authenticated
  using (public.is_admin_or_worker());

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
