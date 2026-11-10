# REC-01 · Recuperación de perfiles y seguridad de Supabase

La revisión partió del DDL histórico del README, los tipos TypeScript y las consultas de ambas aplicaciones. El DDL declara `worker` como rol predeterminado, genera perfiles sin relación con Auth y permite que el borrado de un perfil, pedido o producto elimine historial. El registro activo usa Supabase Auth. El administrador consultaba su perfil con `select('*')` y el alta administrativa actual espera que el trigger copie el rol de metadatos.

El MCP disponible solo muestra **Modulo de Productos y Ofertas**. Quedan pendientes el ID confirmado y la auditoría de **Wankas New**, organización **GabrielPGus**. Se usó exclusivamente una base desechable para ejecutar SQL.

## Migraciones

| Archivo | Cambio |
| --- | --- |
| `20261110204801_rec01_roles_perfiles.sql` | Predetermina `customer`, convierte el rol histórico `user` y los roles nulos en `customer` y valida los tres roles admitidos. Conserva los roles privilegiados existentes para conciliarlos con el inventario autorizado. |
| `20261110204809_rec01_sede_trabajador.sql` | Añade o normaliza `profiles.location_id` como FK UUID nullable a `locations.id`. Una sede asignada debe desasignarse antes de borrarla. |
| `20261110204814_rec01_perfiles_auth.sql` | Vincula `profiles.id` a `auth.users.id` y sustituye el trigger `on_auth_user_created`. Crea perfiles ausentes y altas nuevas como `customer` sin sede. Los metadatos solo aportan el nombre. Un perfil huérfano detiene la migración. |
| `20261110204820_rec01_seguridad_rls.sql` | Sustituye políticas y permisos directos de las seis tablas. Revoca también permisos de columna heredados de la configuración anterior, incluido cualquier permiso directo de lectura de `password_hash`. |
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

El inventario de solo lectura también se ejecutó antes y después de las migraciones en la base aislada. En la tienda pasaron `npm run typecheck` y `npm run build`, con advertencias de dependencias en el build. En el administrador, TypeScript reportó los cinco errores de tipos de PDF que también existen en `origin/main`. Next.js compiló el administrador, pero el prerender de `/dashboard/usuarios` falló porque el entorno local carece de una URL Supabase configurada.

Quedan por probar Auth y PostgREST con sesiones reales en un entorno de ensayo, y la integración funcional con las dos RPC y las APIs administrativas. La prueba SQL de `service_role` verifica su acceso a tablas, mientras que la validación de JWT y los códigos HTTP pertenecen a REC-03.

## Antes de aplicar en Wankas New

1. Confirmar en el panel el nombre, organización y referencia exacta del proyecto. Verificar esa referencia contra la configuración de ambas aplicaciones y el destino de la herramienta de migración.
2. Ejecutar [el inventario de solo lectura](../supabase/auditoria/rec01_preflight.sql). Comparar tipos, restricciones, políticas, índices, ACL y triggers. Revisar si existen otras FK, triggers, vistas, vistas materializadas, RPC o roles heredados que puedan leer o escribir por fuera de las seis tablas. Verificar los esquemas y tablas expuestos en la Data API y que `wankas_internal` quede fuera de ella.
3. Conciliar perfiles huérfanos, correos que correspondan a UUID distintos, roles fuera del dominio, roles privilegiados existentes y sedes asignadas con evidencia de identidad y autorización. Revisar pedidos que ya carezcan de cliente o sede. El vínculo de Auth usa UUID y la migración detiene conflictos de FK o de unicidad.
4. Verificar en un clon de ensayo el trigger de altas, el backfill, los permisos efectivos y la compatibilidad con los contratos de REC-02, REC-03 y sus consumidores. Confirmar que el rol de migración puede modificar el trigger de Auth y que el dueño de la función interna puede crear el perfil con RLS activa. Probar registro, checkout, transición, catálogo, reportes y asignación de sede con usuarios de prueba.
5. Aprobar el PR, acordar el orden con los cambios de aplicaciones y obtener autorización explícita para aplicar en la referencia confirmada. Programar una ventana de mantenimiento con el registro, checkout y administración pausados, un respaldo verificado y un punto de restauración. Capturar políticas, ACL, triggers y FK previos para preparar una corrección hacia adelante o restauración.
6. Ante un error, conservar los registros y revisar qué archivos se confirmaron. Cada archivo SQL tiene su propia transacción y un límite de espera por bloqueos. Validar el estado y las migraciones registradas antes de reintentar el archivo fallido. Para revertir cambios ya confirmados, usar el respaldo o una migración de corrección revisada. Probar la recuperación en el clon antes de autorizar el cambio.

Referencias de Supabase. [Gestión de usuarios](https://supabase.com/docs/guides/auth/managing-user-data) · [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Permisos de la Data API](https://supabase.com/docs/guides/api/securing-your-api)
