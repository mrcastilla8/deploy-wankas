begin;

set local lock_timeout = '5s';

-- Las políticas permisivas se combinan con OR y REVOKE de tabla no revoca
-- privilegios previamente concedidos sobre columnas.
do $$
declare
  table_name text;
  column_list text;
  policy_name text;
begin
  foreach table_name in array array[
    'profiles', 'products', 'categories', 'locations', 'orders', 'order_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    for policy_name in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy %I on public.%I', policy_name, table_name);
    end loop;

    select string_agg(format('%I', attname), ', ' order by attnum)
    into column_list
    from pg_attribute
    where attrelid = format('public.%I', table_name)::regclass
      and attnum > 0 and not attisdropped;

    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      table_name
    );
    execute format(
      'revoke all (%s) on table public.%I from public, anon, authenticated, service_role',
      column_list, table_name
    );
  end loop;
end;
$$;

grant select (id, name, email, phone_number, role, location_id, created_at, updated_at)
  on public.profiles to authenticated, service_role;
grant update (name, phone_number) on public.profiles to authenticated;
grant update (name, email, phone_number, role, location_id, updated_at)
  on public.profiles to service_role;

create policy profiles_read_self on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  )
  with check (
    id = (select auth.uid())
    and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true'
  );

grant select (id, category_id, name_es, name_en, description_es, description_en,
              price, stock, image_urls, thumbnail_url, created_at, updated_at)
  on public.products to anon, authenticated;
grant select (id, name_es, name_en, description_es, description_en, created_at, updated_at)
  on public.categories to anon, authenticated;
grant select (id, name_es, name_en, address, opening_hours_es, opening_hours_en,
              latitude, longitude, created_at, updated_at)
  on public.locations to anon, authenticated;

create policy products_read_catalog on public.products for select to anon, authenticated
  using (true);
create policy categories_read_catalog on public.categories for select to anon, authenticated
  using (true);
create policy locations_read_catalog on public.locations for select to anon, authenticated
  using (true);

grant select, insert, update, delete
  on public.products, public.categories, public.locations to service_role;

grant select on public.orders, public.order_items to authenticated, service_role;

create policy orders_read_customer_or_worker on public.orders for select to authenticated
  using (
    exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and (
          (profile.role = 'customer' and orders.user_id = profile.id)
          or (profile.role = 'worker' and orders.location_id = profile.location_id)
        )
    )
  );

create policy order_items_read_visible_order on public.order_items for select to authenticated
  using (exists (
    select 1 from public.orders where orders.id = order_items.order_id
  ));

-- Revisar dependencias tras sustituir las políticas y el trigger de REC-01.
-- Conservar las funciones y los grants de roles de servidor.
do $$
declare
  legacy record;
  dependent_object text;
begin
  for legacy in
    select p.oid, p.proname, p.proowner
    from pg_proc as p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f' and p.pronargs = 0
      and p.proname in ('handle_new_user', 'is_admin', 'is_admin_or_worker')
  loop
    select pg_describe_object(d.classid, d.objid, d.objsubid)
    into dependent_object
    from pg_depend as d
    where d.refclassid = 'pg_proc'::regclass and d.refobjid = legacy.oid
      and not (d.classid = 'pg_proc'::regclass and d.objid = legacy.oid)
    limit 1;

    if dependent_object is null then
      -- PostgreSQL no registra las llamadas en cuerpos SQL/PLpgSQL escritos como texto.
      select p.oid::regprocedure::text
      into dependent_object
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname not in ('pg_catalog', 'information_schema')
        and p.oid <> legacy.oid
        and p.prosrc ~* ('[[:<:]]' || legacy.proname || '[[:>:]]')
        and not (
          n.nspname = 'public' and p.prokind = 'f' and p.pronargs = 0
          and p.proname in ('handle_new_user', 'is_admin', 'is_admin_or_worker')
          and p.prosecdef and p.proowner = legacy.proowner
        )
      limit 1;
    end if;

    if dependent_object is not null then
      raise exception 'REC-01: dependencia vigente de %: %', legacy.oid::regprocedure, dependent_object
        using hint = 'Revisar el consumidor y sus permisos antes de retirar EXECUTE.';
    end if;

    execute format('revoke execute on function public.%I() from public, anon, authenticated', legacy.proname);
    if has_function_privilege('anon', legacy.oid, 'execute')
       or has_function_privilege('authenticated', legacy.oid, 'execute') then
      raise exception 'REC-01: EXECUTE efectivo persiste para %', legacy.oid::regprocedure
        using hint = 'Revisar membresías y grants heredados antes de reintentar.';
    end if;
  end loop;
end;
$$;

commit;
