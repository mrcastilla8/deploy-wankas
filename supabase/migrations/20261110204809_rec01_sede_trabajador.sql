begin;

set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists location_id uuid;

do $$
declare
  old_fk record;
begin
  for old_fk in
    select c.conname, c.conkey, c.confrelid, c.confkey,
           p.attnum as location_id, l.attnum as target_id
    from pg_constraint as c
    join pg_attribute as p on p.attrelid = c.conrelid and p.attname = 'location_id'
    join pg_attribute as l on l.attrelid = 'public.locations'::regclass and l.attname = 'id'
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'f'
      and p.attnum = any(c.conkey)
  loop
    if old_fk.conkey <> array[old_fk.location_id]
       or old_fk.confrelid <> 'public.locations'::regclass
       or old_fk.confkey <> array[old_fk.target_id] then
      raise exception 'REC-01: FK inesperada de profiles.location_id: %', old_fk.conname;
    end if;
    execute format('alter table public.profiles drop constraint %I', old_fk.conname);
  end loop;
end;
$$;

alter table public.profiles
  alter column location_id drop default,
  alter column location_id drop not null,
  add constraint profiles_location_id_fkey
    foreign key (location_id) references public.locations (id) on delete restrict;

create index if not exists profiles_location_id_idx on public.profiles (location_id);

commit;
