begin;

set local lock_timeout = '5s';

-- El rol histórico "user" de la tienda representa un cliente.
update public.profiles
set role = 'customer'
where role is null or role::text = 'user';

alter table public.profiles
  alter column role set default 'customer',
  alter column role set not null,
  add constraint profiles_rec01_role_check
    check (role in ('customer', 'worker', 'admin'));

commit;
