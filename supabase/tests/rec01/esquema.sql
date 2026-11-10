-- Solo para una base PostgreSQL nueva y desechable. Subconjunto de Auth
-- y esquema comercial basado en README.md, útil para REC-01 y REC-02.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function auth.jwt() returns jsonb
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

grant usage on schema public, auth to anon, authenticated, service_role;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_es text not null,
  name_en text,
  description_es text,
  description_en text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.locations (
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

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  phone_number text,
  role text not null default 'worker',
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories on delete set null,
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

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid constraint legacy_orders_customer_fk references public.profiles on delete cascade,
  location_id uuid references public.locations on delete set null,
  order_date timestamptz not null default now(),
  pickup_date timestamptz not null,
  status text not null default 'pending',
  total_price numeric not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  order_id uuid references public.orders on delete cascade,
  product_id uuid references public.products on delete cascade,
  quantity integer not null,
  price_at_purchase numeric not null,
  primary key (order_id, product_id)
);
