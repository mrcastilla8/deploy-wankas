# Wanka's - Plataforma de Comercio Electrónico Inteligente y Panel de Administración

Este repositorio contiene el sistema completo de **Wanka's**, una plataforma de comercio electrónico de vanguardia para productos comestibles basada en un modelo de **"recojo en tienda y pago al momento"**, potenciada por Inteligencia Artificial (Google Genkit/Gemini) para reconocimiento de alimentos y recomendación de recetas.

El sistema se compone de dos aplicaciones full-stack desarrolladas en **Next.js** que comparten una base de datos en **Supabase** y un sistema de **Inicio de Sesión Único (SSO)** para una administración integrada:

1. **[E-commerce-Wankas](file:///c:/Users/marec/Desktop/Proyecto-Wankas/E-commerce-Wankas)** (Puerto `9000`): Tienda para clientes finales. Incluye catálogo, carrito de compras, programación de recojo en sedes físicas y el **Asistente de IA** (reconocimiento visual de ingredientes y generación inteligente de recetas).
2. **[Administrador-Wankas](file:///c:/Users/marec/Desktop/Proyecto-Wankas/Administrador-Wankas)** (Puerto `9002`): Panel de control administrativo. Permite gestionar productos, categorías, sedes físicas, usuarios, registrar stock e inspeccionar/procesar los pedidos entrantes en tiempo real con reportes de analítica.

---

## 🛠️ Requisitos Previos

Antes de configurar el proyecto, asegúrate de tener instalado:

- **Node.js** (Versión LTS recomendada, v20 o superior)
- **npm** (Viene integrado con Node.js)
- **Supabase** (Una base de datos PostgreSQL en la nube o local. Puedes crear un proyecto gratuito en [supabase.com](https://supabase.com))
- **Google AI Studio Key** (Clave de API para el modelo Gemini, indispensable para usar Genkit. Consíguela gratis en [Google AI Studio](https://aistudio.google.com/))
- *(Opcional)* **Redis Server** (Para almacenar sesiones del SSO. Si no tienes Redis, **no te preocupes**: el sistema incluye un mecanismo de fallback automático que guarda las sesiones localmente en el archivo `.session-store.json` en la raíz de este directorio).

---

## 🚀 Guía de Configuración Paso a Paso

### Paso 1: Configurar la Base de Datos en Supabase

El siguiente DDL describe el esquema histórico. Para revisar la recuperación del proyecto Wankas New y los requisitos previos de seguridad, consultar [REC-01](docs/rec01-seguridad-supabase.md).

1. Ve a tu proyecto de Supabase y abre el **SQL Editor**.
2. Copia y ejecuta la siguiente consulta DDL para crear las tablas necesarias en el esquema `public`:

```sql
-- 1. Tabla de Categorías (categories)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_es text not null,
  name_en text,
  description_es text,
  description_en text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Tabla de Ubicaciones / Sedes (locations)
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name_es text not null,
  name_en text,
  address text not null,
  opening_hours_es jsonb,
  opening_hours_en jsonb,
  latitude numeric,
  longitude numeric,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabla de Perfiles de Usuarios (profiles)
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  phone_number text,
  role text not null default 'worker', -- 'worker' (empleado), 'admin' (administrador), 'customer' (cliente)
  password_hash text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Tabla de Productos (products)
create table public.products (
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Tabla de Pedidos (orders)
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  order_date timestamp with time zone default timezone('utc'::text, now()) not null,
  pickup_date timestamp with time zone not null,
  status text not null default 'pending', -- 'pending' (pendiente), 'completed' (completado), 'cancelled' (cancelado)
  total_price numeric not null,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tabla de Detalles del Pedido (order_items)
create table public.order_items (
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  quantity integer not null,
  price_at_purchase numeric not null,
  primary key (order_id, product_id)
);
```

#### *(Opcional) Script de Carga de Datos Iniciales (Mock Data)*
Para probar la plataforma inmediatamente con productos y sedes, puedes ejecutar el siguiente script en tu editor SQL de Supabase:

```sql
-- Insertar Categorías de prueba
insert into public.categories (name_es, name_en, description_es) values
('Bebidas', 'Drinks', 'Gaseosas, jugos y aguas frescas'),
('Lácteos', 'Dairy', 'Leche, quesos y yogures'),
('Snacks', 'Snacks', 'Piqueos, chocolates y galletas'),
('Abarrotes', 'Groceries', 'Arroz, fideos, aceites y conservas');

-- Insertar Sedes de prueba
insert into public.locations (name_es, address, opening_hours_es) values
('Sede Central - Huancayo', 'Av. Giráldez 456, Huancayo', '{"semana": "08:00 - 21:00", "sabado": "09:00 - 18:00"}'),
('Sede El Tambo', 'Av. Julio C. Tello 123, El Tambo', '{"semana": "08:00 - 20:00"}');
```

---

### Paso 2: Clonar e Instalar Dependencias

Clona el repositorio en tu máquina local e instala las dependencias de ambas aplicaciones desde tu terminal:

1. **Instalar dependencias del E-commerce:**
   ```bash
   cd E-commerce-Wankas
   npm install
   ```

2. **Instalar dependencias del Administrador:**
   ```bash
   cd ../Administrador-Wankas
   npm install
   ```

---

### Paso 3: Configurar Variables de Entorno

Debes crear los archivos de configuración de entorno para que las aplicaciones puedan comunicarse con Supabase y los servicios de IA:

#### 1. En la carpeta `E-commerce-Wankas`:
Crea un archivo llamado `.env` y añade las siguientes claves:

```env
# Supabase - Conexión
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_CLAVE_ANONIMA_SUPABASE

# Google AI (para Genkit y modelos Gemini)
GOOGLE_API_KEY=TU_API_KEY_DE_GOOGLE_AI_STUDIO

# Redis (Opcional - Si no se especifica, usará el fallback de archivo local)
REDIS_URL=redis://localhost:6379
```

#### 2. En la carpeta `Administrador-Wankas`:
Crea un archivo llamado `.env.local` en su respectiva raíz y añade las siguientes claves:

```env
# Supabase - Conexión
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_CLAVE_ANONIMA_SUPABASE
SUPABASE_SERVICE_ROLE_KEY=TU_CLAVE_SERVICE_ROLE_SUPABASE

# Redis (Opcional - Si no se especifica, usará el fallback de archivo local)
REDIS_URL=redis://localhost:6379
```

> [!CAUTION]
> Nunca expongas la clave `SUPABASE_SERVICE_ROLE_KEY` en el cliente. El archivo `.env.local` en Next.js está diseñado para cargarse de forma segura únicamente en el entorno de ejecución del servidor.

---

### Paso 4: Ejecutar las Aplicaciones en Desarrollo

Para ejecutar el sistema completo en modo de desarrollo local:

1. **Ejecutar el E-commerce (Tienda Virtual):**
   Abre una terminal en `E-commerce-Wankas` y corre:
   ```bash
   npm run dev
   ```
   *La aplicación estará activa en:* `http://localhost:9000`

2. **Ejecutar el Administrador (Panel de Control):**
   Abre una nueva terminal en `Administrador-Wankas` y corre:
   ```bash
   npm run dev
   ```
   *La aplicación estará activa en:* `http://localhost:9002`

3. **Ejecutar la interfaz de desarrollo de Genkit (Para probar la IA):**
   Genkit incluye una interfaz de usuario visual interactiva para depurar los flujos de IA (como el reconocedor de imágenes y el generador de recetas). Abre otra terminal en `E-commerce-Wankas` y corre:
   ```bash
   npm run genkit:dev
   ```
   *La interfaz de desarrollo de Genkit estará activa en:* `http://localhost:4000`

---

## 🔐 Mecanismo SSO (Inicio de Sesión Único) y Fallback de Redis

Las dos aplicaciones cuentan con una integración **SSO**. Si un usuario inicia sesión en el E-commerce y cuenta con un rol de administrador o empleado (`admin` o `worker`), podrá ingresar automáticamente al panel administrativo sin necesidad de volver a ingresar sus credenciales.

### ¿Cómo funciona la persistencia de sesión?
1. Se establece una cookie compartida llamada `wankas_sid` que almacena un ID de sesión único generado en el cliente.
2. Cada aplicación consulta el almacenamiento de sesiones para validar el ID.
3. **Almacenamiento por defecto:** El sistema intenta conectarse a un servidor Redis en el puerto 6379.
4. **Fallback sin Redis:** Si no tienes un servidor Redis corriendo, el sistema detectará el fallo de forma transparente y recurrirá a un archivo JSON local en la raíz del espacio de trabajo: `.session-store.json`. Esto permite que el SSO funcione de inmediato en tu computadora local sin necesidad de configuraciones de red complejas.

---

## 🤖 Módulos de Inteligencia Artificial (Genkit)

El e-commerce integra funciones inteligentes ubicadas en `src/ai/flows` que utilizan el SDK de Genkit:
- **`identify-food-items`**: Analiza imágenes de ingredientes subidas por el usuario y los reconoce usando visión computacional.
- **`suggest-recipes`**: A partir de los ingredientes seleccionados o identificados, el modelo Gemini genera recetas personalizadas con ingredientes y pasos paso a paso.
- **`suggest-missing-ingredients`**: Compara los ingredientes necesarios de la receta con lo que el usuario subió originalmente y destaca los ingredientes faltantes, ofreciendo agregarlos al carrito directamente desde el inventario de la tienda.
- **`generate-recipe-image`**: Utiliza modelos generativos para crear una imagen fotorrealista de la receta sugerida.

---

## 📝 Primeros Pasos con Roles y Cuentas

1. Inicia el servidor de e-commerce y navega a `http://localhost:9000`.
2. Dirígete a la sección de **Registro** y crea una cuenta nueva.
3. Por defecto, los nuevos usuarios tienen el rol de `customer`.
4. Para acceder al panel de administración (`http://localhost:9002`), ve a la tabla `profiles` de tu consola de Supabase, busca la fila correspondiente a tu cuenta y edita la columna `role` a **`admin`** o **`worker`**.
5. Vuelve al panel administrativo y actualiza la página; el sistema reconocerá tu sesión de SSO automáticamente y te dará acceso completo al dashboard de Wanka's.
