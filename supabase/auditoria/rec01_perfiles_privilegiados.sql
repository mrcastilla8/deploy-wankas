-- Solo para el responsable de Wankas New. El resultado contiene datos personales.
-- Comparar cada UUID y rol con el listado autorizado de personal.
begin read only;

select p.id as profile_id, p.role, p.name, p.email as profile_email,
       u.id is not null as auth_exists, u.email as auth_email,
       u.email_confirmed_at is not null as email_confirmed
from public.profiles as p
left join auth.users as u on u.id = p.id
where p.role in ('admin', 'worker')
order by p.role, p.id;

rollback;
