begin;

set local lock_timeout = '5s';
lock table auth.users in share row exclusive mode;
lock table public.profiles in access exclusive mode;

do $$
declare
  old_fk record;
begin
  if exists (
    select 1
    from public.profiles as profile
    left join auth.users as auth_user on auth_user.id = profile.id
    where auth_user.id is null
  ) then
    raise exception 'REC-01: existen perfiles sin identidad Auth por UUID'
      using hint = 'Conciliar las identidades y sus referencias antes de reintentar.';
  end if;

  for old_fk in
    select c.conname, c.conkey, c.confrelid, c.confkey,
           p.attnum as profile_id, u.attnum as auth_id
    from pg_constraint as c
    join pg_attribute as p on p.attrelid = c.conrelid and p.attname = 'id'
    join pg_attribute as u on u.attrelid = 'auth.users'::regclass and u.attname = 'id'
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and p.attnum = any(c.conkey)
  loop
    if old_fk.conkey <> array[old_fk.profile_id]
       or old_fk.confrelid <> 'auth.users'::regclass
       or old_fk.confkey <> array[old_fk.auth_id] then
      raise exception 'REC-01: FK inesperada de profiles.id: %', old_fk.conname;
    end if;
    execute format('alter table public.profiles drop constraint %I', old_fk.conname);
  end loop;
end;
$$;

alter table public.profiles
  alter column id drop default,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;

create schema if not exists wankas_internal;
revoke all on schema wankas_internal from public, anon, authenticated;

create function wankas_internal.rec01_create_customer_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
  assigned_role text;
  assigned_location uuid;
begin
  insert into public.profiles (id, email, name, role, location_id)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name', 'customer', null)
  returning id, role, location_id into created_id, assigned_role, assigned_location;

  if created_id is distinct from new.id
     or assigned_role is distinct from 'customer'
     or assigned_location is not null then
    raise exception 'REC-01: el alta de Auth debe crear un perfil customer con el mismo UUID y sin sede';
  end if;
  return new;
end;
$$;

revoke all on function wankas_internal.rec01_create_customer_profile()
  from public, anon, authenticated, service_role;

-- Sustituye el disparador de perfiles referenciado por el administrador.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function wankas_internal.rec01_create_customer_profile();

-- Solo recuperar perfiles ausentes, sin sobrescribir roles ni datos existentes.
insert into public.profiles (id, email, name, role, location_id)
select auth_user.id, auth_user.email, auth_user.raw_user_meta_data ->> 'name', 'customer', null
from auth.users as auth_user
where not exists (
  select 1 from public.profiles as profile where profile.id = auth_user.id
);

commit;
