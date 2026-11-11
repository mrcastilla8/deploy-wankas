-- ============================================================================
-- REC-02 / DEV-2 (TACO)
-- Pedidos, checkout e inventario transaccionales.
--
-- Contratos obligatorios:
--   place_order_atomic(location_id, pickup_date, notes, items)
--     -> order_id, total_price, status
--   transition_order_atomic(order_id, new_status)
--     -> order_id, status
--
-- Dependencias:
--   * REC-01: public.profiles.id = auth.users.id, public.profiles.role y
--     public.profiles.location_id (asignación persistente trabajador-sede).
--   * REC-03: expone PATCH /api/admin/pedidos y llama a
--     transition_order_atomic con el access token del usuario, nunca con
--     service_role (auth.uid() debe ser la identidad real).
--
-- Este archivo NO define RLS ni políticas generales: pertenecen a REC-01.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Precondiciones de esquema compartido
-- ----------------------------------------------------------------------------
do $precondiciones$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'location_id'
  ) then
    raise exception
      'REC-02 requiere public.profiles.location_id. Aplicar antes la migración de REC-01.';
  end if;

  if to_regclass('public.orders') is null
     or to_regclass('public.order_items') is null
     or to_regclass('public.products') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.profiles') is null then
    raise exception
      'REC-02 requiere las tablas public.profiles, locations, products, orders y order_items.';
  end if;
end;
$precondiciones$;

-- ----------------------------------------------------------------------------
-- Tipo de retorno de la transición.
-- Se usa un tipo compuesto porque el parámetro de entrada se llama order_id y
-- RETURNS TABLE(order_id, status) duplicaría el nombre del parámetro.
-- ----------------------------------------------------------------------------
do $tipo$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'order_transition_result'
  ) then
    create type public.order_transition_result as (
      order_id uuid,
      status text
    );
  end if;
end;
$tipo$;

-- ----------------------------------------------------------------------------
-- Crear pedido y reservar stock de forma atómica.
--
-- items: [{"product_id": "<uuid>", "quantity": <entero > 0>}, ...]
-- El precio y el total SIEMPRE se calculan desde public.products.
-- El comprador SIEMPRE se deriva de auth.uid().
-- ----------------------------------------------------------------------------
drop function if exists public.place_order_atomic(uuid, timestamptz, text, jsonb);

create function public.place_order_atomic(
  location_id uuid,
  pickup_date timestamptz,
  notes text,
  items jsonb
)
returns table (
  order_id uuid,
  total_price numeric,
  status text
)
language plpgsql
security definer
set search_path = public
as $place_order$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_order_id uuid;
  v_total numeric;
  v_notes text;
  v_item record;
begin
  -- Identidad real del comprador (nunca la envía el navegador).
  if v_uid is null then
    raise exception 'Debes iniciar sesión para crear un pedido.'
      using errcode = '28000', hint = 'NO_AUTENTICADO';
  end if;

  select p.role
    into v_role
    from public.profiles p
   where p.id = v_uid;

  if not found then
    raise exception 'No existe un perfil asociado a la sesión.'
      using errcode = '28000', hint = 'NO_AUTENTICADO';
  end if;

  -- En el proyecto real los clientes usan el rol 'user'; se acepta 'customer'
  -- como alias por compatibilidad con el esquema del README.
  if v_role is null or v_role not in ('user', 'customer', 'worker', 'admin') then
    raise exception 'El rol de la sesión no puede crear pedidos.'
      using errcode = '42501', hint = 'SIN_PERMISO';
  end if;

  -- Sede de recojo.
  if place_order_atomic.location_id is null then
    raise exception 'La sede de recojo es obligatoria.'
      using errcode = '22023', hint = 'SEDE_INVALIDA';
  end if;

  if not exists (
    select 1 from public.locations l where l.id = place_order_atomic.location_id
  ) then
    raise exception 'La sede de recojo no existe.'
      using errcode = '22023', hint = 'SEDE_INVALIDA';
  end if;

  -- Fecha de recojo.
  if place_order_atomic.pickup_date is null
     or place_order_atomic.pickup_date <= now() then
    raise exception 'La fecha de recojo debe ser futura.'
      using errcode = '22023', hint = 'FECHA_INVALIDA';
  end if;

  -- Notas.
  v_notes := nullif(btrim(coalesce(place_order_atomic.notes, '')), '');
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'Las notas no pueden superar 1000 caracteres.'
      using errcode = '22023', hint = 'NOTAS_INVALIDAS';
  end if;

  -- Estructura de items.
  if place_order_atomic.items is null
     or jsonb_typeof(place_order_atomic.items) <> 'array' then
    raise exception 'El pedido debe incluir un arreglo de productos.'
      using errcode = '22023', hint = 'ITEM_INVALIDO';
  end if;

  if jsonb_array_length(place_order_atomic.items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.'
      using errcode = '22023', hint = 'ITEM_INVALIDO';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(place_order_atomic.items) as elem
     where case
       when jsonb_typeof(elem) <> 'object' then true
       when not (elem ? 'product_id') or not (elem ? 'quantity') then true
       when jsonb_typeof(elem -> 'product_id') <> 'string' then true
       when jsonb_typeof(elem -> 'quantity') <> 'number' then true
       when (elem ->> 'quantity')::numeric <= 0 then true
       when (elem ->> 'quantity')::numeric <> trunc((elem ->> 'quantity')::numeric) then true
       when (elem ->> 'quantity')::numeric > 2147483647 then true
       else false
     end
  ) then
    raise exception 'Cada producto debe tener product_id y una cantidad entera mayor que cero.'
      using errcode = '22023', hint = 'ITEM_INVALIDO';
  end if;

  -- Productos existentes.
  if exists (
    select 1
      from (
        select distinct (elem ->> 'product_id')::uuid as product_id
          from jsonb_array_elements(place_order_atomic.items) as elem
      ) requested
      left join public.products p on p.id = requested.product_id
     where p.id is null
  ) then
    raise exception 'Uno o más productos del pedido no existen.'
      using errcode = '22023', hint = 'PRODUCTO_INVALIDO';
  end if;

  -- Bloqueo determinista por id para evitar deadlocks entre compradores.
  perform p.id
    from public.products p
   where p.id in (
     select distinct (elem ->> 'product_id')::uuid
       from jsonb_array_elements(place_order_atomic.items) as elem
   )
   order by p.id
   for update;

  -- Validación de stock con el agregado por producto (soporta duplicados).
  for v_item in
    select p.id,
           p.name_es,
           p.stock,
           requested.quantity
      from (
        select (elem ->> 'product_id')::uuid as product_id,
               sum((elem ->> 'quantity')::numeric)::integer as quantity
          from jsonb_array_elements(place_order_atomic.items) as elem
         group by 1
      ) requested
      join public.products p on p.id = requested.product_id
     order by p.id
  loop
    if v_item.stock < v_item.quantity then
      raise exception 'No hay stock suficiente para "%". Disponible: %, solicitado: %.',
        v_item.name_es, v_item.stock, v_item.quantity
        using errcode = '23514', hint = 'STOCK_INSUFICIENTE';
    end if;
  end loop;

  -- Reserva de stock (se descuenta al crear; completar no vuelve a descontar).
  update public.products p
     set stock = p.stock - requested.quantity,
         updated_at = now()
    from (
      select (elem ->> 'product_id')::uuid as product_id,
             sum((elem ->> 'quantity')::numeric)::integer as quantity
        from jsonb_array_elements(place_order_atomic.items) as elem
       group by 1
    ) requested
   where p.id = requested.product_id;

  -- Total calculado desde la base de datos.
  select round(coalesce(sum(p.price * requested.quantity), 0), 2)
    into v_total
    from (
      select (elem ->> 'product_id')::uuid as product_id,
             sum((elem ->> 'quantity')::numeric)::integer as quantity
        from jsonb_array_elements(place_order_atomic.items) as elem
       group by 1
    ) requested
    join public.products p on p.id = requested.product_id;

  insert into public.orders (
    user_id,
    location_id,
    pickup_date,
    status,
    total_price,
    notes
  )
  values (
    v_uid,
    place_order_atomic.location_id,
    place_order_atomic.pickup_date,
    'pending',
    v_total,
    v_notes
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    quantity,
    price_at_purchase
  )
  select v_order_id,
         requested.product_id,
         requested.quantity,
         p.price
    from (
      select (elem ->> 'product_id')::uuid as product_id,
             sum((elem ->> 'quantity')::numeric)::integer as quantity
        from jsonb_array_elements(place_order_atomic.items) as elem
       group by 1
    ) requested
    join public.products p on p.id = requested.product_id;

  return query
    select v_order_id, v_total, 'pending'::text;
end;
$place_order$;

-- ----------------------------------------------------------------------------
-- Transición de estado atómica.
--
--   pending -> completed  (no descuenta stock: ya se reservó al crear)
--   pending -> cancelled  (devuelve stock exactamente una vez)
--
-- Autorización:
--   admin  -> cualquier pedido
--   worker -> solo pedidos de su public.profiles.location_id
--   user/customer -> solo cancelar su propio pedido
-- ----------------------------------------------------------------------------
drop function if exists public.transition_order_atomic(uuid, text);

create function public.transition_order_atomic(
  order_id uuid,
  new_status text
)
returns public.order_transition_result
language plpgsql
security definer
set search_path = public
as $transition_order$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_worker_location uuid;
  v_current_status text;
  v_order_user uuid;
  v_order_location uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para cambiar el estado de un pedido.'
      using errcode = '28000', hint = 'NO_AUTENTICADO';
  end if;

  select p.role, p.location_id
    into v_role, v_worker_location
    from public.profiles p
   where p.id = v_uid;

  if not found then
    raise exception 'No existe un perfil asociado a la sesión.'
      using errcode = '28000', hint = 'NO_AUTENTICADO';
  end if;

  if transition_order_atomic.order_id is null then
    raise exception 'El pedido es obligatorio.'
      using errcode = '22023', hint = 'PEDIDO_NO_ENCONTRADO';
  end if;

  if transition_order_atomic.new_status is null
     or transition_order_atomic.new_status not in ('completed', 'cancelled') then
    raise exception 'El estado destino debe ser "completed" o "cancelled".'
      using errcode = '22023', hint = 'ESTADO_INVALIDO';
  end if;

  -- Bloqueo del pedido: serializa transiciones concurrentes.
  select o.status, o.user_id, o.location_id
    into v_current_status, v_order_user, v_order_location
    from public.orders o
   where o.id = transition_order_atomic.order_id
   for update;

  if not found then
    raise exception 'El pedido no existe.'
      using errcode = '22023', hint = 'PEDIDO_NO_ENCONTRADO';
  end if;

  -- Autorización derivada de PostgreSQL, nunca de parámetros del cliente.
  if v_role = 'admin' then
    null;
  elsif v_role = 'worker' then
    if v_worker_location is null
       or v_order_location is distinct from v_worker_location then
      raise exception 'No tienes autorización sobre la sede de este pedido.'
        using errcode = '42501', hint = 'SIN_PERMISO';
    end if;
  elsif v_role in ('user', 'customer') then
    if v_order_user is distinct from v_uid then
      raise exception 'No puedes modificar pedidos de otros usuarios.'
        using errcode = '42501', hint = 'SIN_PERMISO';
    end if;

    if transition_order_atomic.new_status <> 'cancelled' then
      raise exception 'Solo puedes cancelar tus propios pedidos pendientes.'
        using errcode = '42501', hint = 'SIN_PERMISO';
    end if;
  else
    raise exception 'El rol de la sesión no puede cambiar pedidos.'
      using errcode = '42501', hint = 'SIN_PERMISO';
  end if;

  -- Idempotencia: repetir la misma transición no vuelve a mover stock.
  if v_current_status = transition_order_atomic.new_status then
    return (transition_order_atomic.order_id, v_current_status)::public.order_transition_result;
  end if;

  -- Estados terminales: solo se permite pending -> completed/cancelled.
  if v_current_status <> 'pending' then
    raise exception 'Transición no permitida: % -> %.',
      v_current_status, transition_order_atomic.new_status
      using errcode = '23514', hint = 'TRANSICION_INVALIDA';
  end if;

  if transition_order_atomic.new_status = 'cancelled' then
    update public.products p
       set stock = p.stock + oi.quantity,
           updated_at = now()
      from public.order_items oi
     where oi.order_id = transition_order_atomic.order_id
       and p.id = oi.product_id;
  end if;

  update public.orders o
     set status = transition_order_atomic.new_status,
         updated_at = now()
   where o.id = transition_order_atomic.order_id;

  return (transition_order_atomic.order_id, transition_order_atomic.new_status)::public.order_transition_result;
end;
$transition_order$;

-- ----------------------------------------------------------------------------
-- Permisos mínimos: solo usuarios autenticados; nunca anon/PUBLIC.
-- ----------------------------------------------------------------------------
revoke all on function public.place_order_atomic(uuid, timestamptz, text, jsonb) from public;
revoke all on function public.place_order_atomic(uuid, timestamptz, text, jsonb) from anon;
grant execute on function public.place_order_atomic(uuid, timestamptz, text, jsonb) to authenticated;

revoke all on function public.transition_order_atomic(uuid, text) from public;
revoke all on function public.transition_order_atomic(uuid, text) from anon;
grant execute on function public.transition_order_atomic(uuid, text) to authenticated;

comment on function public.place_order_atomic(uuid, timestamptz, text, jsonb)
  is 'REC-02: crea un pedido y reserva stock de forma atómica. Identidad desde auth.uid().';
comment on function public.transition_order_atomic(uuid, text)
  is 'REC-02: pending->completed/cancelled de forma atómica e idempotente. Autoriza por rol y sede.';

commit;
