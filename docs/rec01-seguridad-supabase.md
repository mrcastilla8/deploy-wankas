# REC-01 · Recuperación de perfiles y seguridad de Supabase

La revisión partió del DDL histórico del README, los tipos TypeScript y las consultas de ambas aplicaciones. El DDL declara `worker` como rol predeterminado, genera perfiles sin relación con Auth y permite que el borrado de un perfil, pedido o producto elimine historial. El registro activo usa Supabase Auth. El administrador consultaba su perfil con `select('*')` y el alta administrativa actual espera que el trigger copie el rol de metadatos.

La segunda auditoría aprobó el código de REC-01 en el PR #7, commit `334b392`, y verificó mediante Supabase MCP en modo lectura el proyecto **Wankas New** de **GabrielPGus**, referencia `wryrhzvhjtjqjellypeo`. Confirmó 31 perfiles (25 `user`, 3 `worker` y 3 `admin`), todos vinculados a Supabase Auth, sin perfiles huérfanos. También confirmó 39 pedidos y 104 líneas de pedido.

Quedan pendientes la confirmación administrativa de los seis roles privilegiados y las pruebas integradas con Auth y PostgREST. Las migraciones de prueba se ejecutaron en bases aisladas.

## Migraciones

| Archivo | Cambio |
| --- | --- |
| `20261110204801_rec01_roles_perfiles.sql` | Predetermina `customer`, convierte el rol histórico `user` y los roles nulos en `customer` y valida los tres roles admitidos. Conserva los roles privilegiados existentes para conciliarlos con el inventario autorizado. |
| `20261110204809_rec01_sede_trabajador.sql` | Añade o normaliza `profiles.location_id` como FK UUID nullable a `locations.id`. Una sede asignada debe desasignarse antes de borrarla. |
| `20261110204814_rec01_perfiles_auth.sql` | Vincula `profiles.id` a `auth.users.id` y sustituye el trigger `on_auth_user_created`. Altas y perfiles recuperados reciben nombre, correo y teléfono de Auth, con `phone_number` de metadatos como respaldo de contacto. Se crean como `customer` sin sede. Un perfil huérfano detiene la migración. |
| `20261110204820_rec01_seguridad_rls.sql` | Sustituye políticas y permisos directos de las seis tablas, incluido el acceso de columna a `password_hash`. Revisa dependencias vigentes y revoca el `EXECUTE` de navegador sobre las tres funciones heredadas. |
| `20261110204825_rec01_integridad_historial.sql` | Sustituye las cuatro FK de pedidos y sus líneas por `ON DELETE RESTRICT`. Si existe una FK incompatible, falla antes de confirmar la transacción. |

La FK Auth → perfil elimina el perfil al borrar una cuenta sin pedidos. Si hay historial, la FK de pedidos bloquea el borrado de la cuenta. Se conservan las filas y los precios históricos. Los pedidos que ya tengan una referencia nula conservan ese estado para conciliación. Un cambio de rol histórico y la creación de perfiles ausentes son las únicas escrituras de datos de las migraciones.

La tienda envía el nombre a Auth y se retiró su acción antigua sin consumidores que guardaba credenciales en perfiles. El administrador solicita campos explícitos del perfil, incluida la sede asignada. Los tipos reflejan el UUID exigido, los roles válidos y la sede nullable.

## Permisos y contratos

- El catálogo público expone las columnas conocidas de productos, categorías y sedes. Validar con el inventario real si existen atributos de publicación o columnas que requieran ajustar esa lista.
- Una sesión de cuenta registrada puede leer su perfil y actualizar `name` y `phone_number`. El cliente lee sus propios pedidos. El trabajador lee los de su sede asignada. Las líneas siguen la visibilidad del pedido. Un trabajador sin sede queda sin acceso a pedidos. Una sesión anónima de Auth conserva acceso al catálogo público.
- El administrador hace lecturas y operaciones privilegiadas mediante APIs autorizadas de servidor. La sesión del navegador solo tiene acceso al catálogo y a su propio perfil. El cliente servidor `service_role` puede gestionar catálogo, leer pedidos y actualizar campos permitidos del perfil, incluidos el rol y la sede. La autorización del actor corresponde a la API.
- **REC-02** debe reemplazar escrituras directas de checkout, stock, cancelación y transición con `place_order_atomic(location_id, pickup_date, notes, items)` y `transition_order_atomic(order_id, new_status)`. Las funciones deben usar la identidad de la sesión, verificar `profiles.role` y la sede persistida, conservar sus retornos acordados y tener los privilegios mínimos para sus escrituras transaccionales. La escritura de pedidos y líneas requiere el rol que ejecuta la función transaccional autorizada.
- **REC-03** debe validar Bearer con Auth y autorizar con el perfil de la base antes de usar `service_role` o una caché. Para crear personal, el alta Auth genera el perfil `customer` y la API autorizada asigna explícitamente rol y sede. La lista de usuarios debe seleccionar columnas explícitas. La API de pedidos filtra trabajadores por sede persistida antes de devolver resultados. `PATCH /api/admin/pedidos` delega a la función de REC-02 con la identidad del actor. Los conflictos de borrado por FK deben devolverse como 409.
- Los consumidores administrativos de REC-05 deben usar los endpoints autorizados para escrituras de catálogo y sedes, lectura administrativa de pedidos y reportes. La pantalla de selección de sede de `main` aún guarda una elección local, que carece de autoridad en PostgreSQL. La asignación operativa debe venir de REC-03.

`20261110090000_pedidos_stock_atomicos.sql` exige `profiles.location_id`. Se pidió a Taco que mueva su versión a un timestamp posterior a `20261110204825` para que Supabase ejecute todas las migraciones de REC-01 primero. La confirmación y el cambio de nombre corresponden a REC-02. [Coordinación en el PR #6](https://github.com/mrcastilla8/deploy-wankas/pull/6#issuecomment-6781245571)

## Funciones heredadas

El responsable reporta que `public.handle_new_user()`, `public.is_admin()` y `public.is_admin_or_worker()` son `SECURITY DEFINER` y tienen `EXECUTE` para `anon` y `authenticated`. La segunda auditoría confirmó que sus dependencias en Wankas New corresponden a objetos que las migraciones de REC-01 reemplazan. El preflight enumera los consumidores registrados en el catálogo y busca menciones en cuerpos de otras rutinas. [Dependencias en PostgreSQL](https://www.postgresql.org/docs/current/ddl-depend.html)

Tras reemplazar el trigger de alta y las políticas de las seis tablas, la migración conserva las definiciones y los grants directos de servidor. Revoca `EXECUTE` de `PUBLIC`, `anon` y `authenticated`. Si encuentra un consumidor restante o un permiso efectivo heredado, revierte la transacción de RLS y muestra el objeto o la función que requiere revisión. En el clon, verificar especialmente políticas de Storage, vistas, otras RPC y funciones de Auth.

## Pruebas locales

El esquema de pruebas sirve para REC-02. Modela las tablas documentadas, roles PostgreSQL y un subconjunto de Auth. Usa `request.jwt.claim.sub` y `request.jwt.claims` para simular el contexto de una sesión. [Esquema de pruebas](../supabase/tests/rec01/esquema.sql)

Ejecutar desde la raíz del repositorio con PowerShell. Usar un clúster PostgreSQL nuevo, local y descartable, con la base `wankas_rec01` creada y el servidor escuchando en el puerto local 55431.

```powershell
$rec01Files = @('supabase/tests/rec01/esquema.sql', 'supabase/tests/rec01/datos_previos.sql')
$rec01Files += Get-ChildItem supabase/migrations/*_rec01_*.sql | Sort-Object Name | ForEach-Object FullName
$rec01Files += 'supabase/tests/rec01/seguridad.sql'
foreach ($rec01File in $rec01Files) {
  psql -X -h 127.0.0.1 -p 55431 -U postgres -d wankas_rec01 -v ON_ERROR_STOP=1 -f $rec01File
  if ($LASTEXITCODE -ne 0) { throw "Falló $rec01File" }
}
```

**Resultado local**. PostgreSQL 17.5 embebido ejecutó las cinco migraciones y las aserciones de registro, recuperación, roles, RLS, privilegios de columna, reasignación y protección del historial. En una segunda base aislada, un perfil sin usuario Auth detuvo la migración de Auth y se comprobó que el registro seguía presente tras revertir la transacción. Para reproducir ese caso, cargar solo `esquema.sql`, insertar un perfil con `insert into public.profiles (name) values ('Huérfano de prueba')` y ejecutar las tres primeras migraciones de REC-01. Esperar `P0001` en la de Auth y verificar que el perfil siga presente.

En la revisión se ejecutaron ambos preflights en PostgreSQL 17.5 embebido. Los datos ficticios incluyeron 25 perfiles `user`, tres `worker` y tres `admin`. Las pruebas cubrieron la conversión, la conservación de roles de personal, el teléfono de Auth y el de respaldo, la denegación de `EXECUTE` para ambos roles de navegador y la conservación del acceso directo de servidor. Se comprobó la reversión de RLS en tres bases aisladas al encontrar una vista dependiente, una llamada en el cuerpo de otra función o un grant heredado.

El SQL de REC-02 en `68a3cfab9ea28cf29ad9b8c890962ab1991fbbc7` falló por falta de `profiles.location_id` cuando se ejecutó primero. Después de aplicar REC-01 en la base aislada, la RPC de checkout reservó dos unidades y la de transición completó el pedido como trabajador de la sede, con stock final de ocho. Quedan por probar Auth, PostgREST y las APIs administrativas con sesiones reales en un entorno de ensayo.

En la primera revisión de la tienda pasaron `npm run typecheck` y `npm run build`, con advertencias de dependencias en el build. TypeScript reportó en el administrador los cinco errores de tipos de PDF que también existen en `origin/main`. Next.js compiló el administrador y el prerender de `/dashboard/usuarios` se detuvo por falta de URL de Supabase local.

## Antes de aplicar en Wankas New

1. Verificar que la configuración de ambas aplicaciones y el destino de la herramienta de migración coincidan con la referencia auditada `wryrhzvhjtjqjellypeo`.
2. Usar el inventario de solo lectura para contrastar el estado antes del despliegue. Verificar los esquemas y tablas expuestos en la Data API y que `wankas_internal` quede fuera de ella. [Inventario de solo lectura](../supabase/auditoria/rec01_preflight.sql)
3. Completar la confirmación administrativa de los seis roles privilegiados. Cotejar UUID, cuenta Auth y rol de los tres administradores y tres trabajadores con la lista autorizada del negocio. Mantener el resultado en el entorno privado de auditoría. [Preflight privado](../supabase/auditoria/rec01_perfiles_privilegiados.sql)
4. Verificar en un clon de ensayo el trigger de altas, el backfill, los permisos efectivos y la compatibilidad con los contratos de REC-02, REC-03 y sus consumidores. Confirmar que el rol de migración puede modificar el trigger de Auth y que el dueño de la función interna puede crear el perfil con RLS activa. Probar registro, checkout, transición, catálogo, reportes y asignación de sede con usuarios de prueba.
5. Confirmar que REC-02 use un timestamp posterior a `20261110204825`, acordar el orden con los cambios de aplicaciones y obtener autorización explícita para aplicar en la referencia confirmada. Programar una ventana de mantenimiento con el registro, checkout y administración pausados, un respaldo verificado y un punto de restauración. Capturar políticas, ACL, triggers y FK previos para preparar una corrección hacia adelante o restauración.
6. Ante un error, conservar los registros y revisar qué archivos se confirmaron. Cada archivo SQL tiene su propia transacción y un límite de espera por bloqueos. Validar el estado y las migraciones registradas antes de reintentar el archivo fallido. Para revertir cambios ya confirmados, usar el respaldo o una migración de corrección revisada. Probar la recuperación en el clon antes de autorizar el cambio.

Referencias de Supabase. [Gestión de usuarios](https://supabase.com/docs/guides/auth/managing-user-data) · [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Permisos de la Data API](https://supabase.com/docs/guides/api/securing-your-api)
