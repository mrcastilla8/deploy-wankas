-- Ejecutar en modo lectura solo después de verificar el ID de Wankas New.
-- Inventario de esquema y conteos agregados, sin correos, UUID de usuarios ni hashes.
begin read only;

select current_database() as database_name, current_setting('server_version') as server_version;

select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       a.attname as column_name, format_type(a.atttypid, a.atttypmod) as column_type,
       a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as column_default
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
join pg_attribute as a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef as d on d.adrelid = c.oid and d.adnum = a.attnum
where (n.nspname = 'public' and c.relname in (
  'profiles', 'products', 'categories', 'locations', 'orders', 'order_items'
)) or (n.nspname = 'auth' and c.relname = 'users' and a.attname in ('id', 'email', 'raw_user_meta_data'))
order by n.nspname, c.relname, a.attnum;

select conrelid::regclass as source_table, conname, convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = any(array[
  to_regclass('public.profiles'), to_regclass('public.products'), to_regclass('public.categories'),
  to_regclass('public.locations'), to_regclass('public.orders'), to_regclass('public.order_items')
]) or confrelid = any(array[
  to_regclass('auth.users'), to_regclass('public.profiles'), to_regclass('public.products'),
  to_regclass('public.locations'), to_regclass('public.orders'), to_regclass('public.order_items')
])
order by conrelid::regclass::text, conname;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles', 'products', 'categories', 'locations', 'orders', 'order_items')
order by tablename, indexname;

select tgrelid::regclass as table_name, tgname, tgenabled, tgfoid::regprocedure as trigger_function,
       pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal and tgrelid = any(array[
  to_regclass('auth.users'), to_regclass('public.profiles'), to_regclass('public.products'),
  to_regclass('public.categories'), to_regclass('public.locations'), to_regclass('public.orders'),
  to_regclass('public.order_items')
])
order by tgrelid, tgname;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'products', 'categories', 'locations', 'orders', 'order_items')
order by tablename, policyname;

select table_name, grantee, privilege_type, is_grantable
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'products', 'categories', 'locations', 'orders', 'order_items')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('profiles', 'products', 'categories', 'locations', 'orders', 'order_items')
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by table_name, column_name, grantee, privilege_type;

select rolname, rolsuper, rolbypassrls
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', current_user)
order by rolname;

select member_role.rolname as member_role, granted_role.rolname as granted_role
from pg_auth_members as membership
join pg_roles as member_role on member_role.oid = membership.member
join pg_roles as granted_role on granted_role.oid = membership.roleid
where member_role.rolname in ('anon', 'authenticated', 'service_role')
   or granted_role.rolname in ('anon', 'authenticated', 'service_role')
order by 1, 2;

select p.oid::regprocedure as signature, pg_get_function_result(p.oid) as result_type,
       p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner_name,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_execute
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by p.proname, p.oid;

select distinct view_schema, view_name, table_name
from information_schema.view_table_usage
where table_schema = 'public'
  and table_name in ('profiles', 'products', 'categories', 'locations', 'orders', 'order_items')
order by view_schema, view_name, table_name;

select role, count(*) as profiles
from public.profiles
group by role
order by role;

select
  (select count(*) from public.profiles p left join auth.users u on p.id = u.id where u.id is null)
    as profiles_without_auth,
  (select count(*) from auth.users u left join public.profiles p on u.id = p.id where p.id is null)
    as auth_without_profiles,
  (select count(*) from auth.users u join public.profiles p on u.email = p.email where u.id <> p.id)
    as emails_linked_to_different_uuid,
  (select count(*) from public.orders where user_id is null) as orders_without_customer,
  (select count(*) from public.orders where location_id is null) as orders_without_location;

rollback;
