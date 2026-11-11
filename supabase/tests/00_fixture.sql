-- ============================================================================
-- REC-02 / DEV-2 (TACO) — Fixture de pruebas SQL
--
-- SOLO para una base PostgreSQL local/aislada de pruebas.
-- NO aplicar a producción ni al proyecto Supabase real.
--
-- Crea el mínimo esquema compartido que REC-02 necesita para probar las
-- funciones transaccionales sin depender de las migraciones de REC-01.
-- En un entorno real, las tablas y RLS las administra REC-01.
-- ============================================================================

\set ON_ERROR_STOP on

create schema if not exists auth;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin';
  end if;
end;
$roles$;

-- Simulación local de auth.uid() de Supabase.
-- En Supabase real esta función ya existe y NO debe reemplazarse.
create or replace function auth.uid()
returns uuid
language sql
stable
as $uid$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$uid$;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name_es text not null,
  name_en text,
  description_es text,
  description_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name_es text not null,
  name_en text,
  address text not null,
  opening_hours_es jsonb,
  opening_hours_en jsonb,
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  name text,
  email text unique,
  phone_number text,
  role text not null default 'user',
  password_hash text,
  location_id uuid references public.locations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Si el esquema ya existía sin la asignación persistente de REC-01.
alter table public.profiles
  add column if not exists location_id uuid references public.locations(id) on delete set null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name_es text not null,
  name_en text,
  description_es text,
  description_en text,
  price numeric not null,
  stock integer not null default 0,
  image_urls text[],
  thumbnail_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_date timestamptz not null default now(),
  pickup_date timestamptz not null,
  status text not null default 'pending',
  total_price numeric not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  quantity integer not null,
  price_at_purchase numeric not null,
  primary key (order_id, product_id)
);

-- En Supabase estos privilegios ya existen. En local permiten que los tests
-- cambien de rol si hiciera falta.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
