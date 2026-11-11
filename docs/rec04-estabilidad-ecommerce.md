# REC-04 · Estabilidad de autenticación y catálogo

## Fallos corregidos

El callback de `onAuthStateChange` esperaba una consulta de `profiles`, con riesgo de bloquear otros eventos de Auth. El contexto también aceptaba identidades creadas por el navegador, persistía `wankas-user`, borraba claves privadas del SDK al cerrar sesión y permitía que lecturas lentas repusieran un usuario anterior. El login enviaba el parámetro `redirect` sin validarlo. El registro enviaba un rol de cliente y asumía que todo alta abría una sesión. La acción heredada autenticaba contra hashes en `profiles` y podía crear IDs sin relación con Auth. El catálogo sustituía errores por datos locales, usaba Redis y caché de navegador de cinco minutos, y eliminaba productos con nombres repetidos. Los flujos Genkit imprimían entradas completas.

## Cambios y arquitectura final

- `E-commerce-Wankas/src/context/auth-context.tsx`: Supabase Auth es la fuente de sesión. El listener es síncrono; programa la hidratación fuera del callback. Un guard de generación descarta lecturas antiguas después de cambios rápidos, logout o desmontaje. Los fallos de perfil dejan el rol informativo en `null`, conservan la sesión válida y terminan la carga. Logout usa `signOut`, mantiene el estado ante fallo, informa con toast y navega a `/login` solo al confirmar.
- `E-commerce-Wankas/src/lib/authRequestGuard.ts`: guard comprobable de respuestas de perfil asíncronas.
- `E-commerce-Wankas/src/lib/safeRedirect.ts` y `components/auth/login-form.tsx`: solo permiten rutas internas seguras con fallback `/profile`; tanto sesión existente como login usan el mismo destino validado. La navegación posterior al submit queda en el efecto de sesión.
- `components/auth/register-form.tsx`: solo usa `signUp` y envía `{ name }`; con sesión va a `/profile`, sin sesión informa que debe confirmar el correo y pasa a `/login`. Los errores no fabrican identidad local.
- `src/actions/auth.ts`: eliminado después de buscar referencias; no quedan consumidores `registerUser` ni `loginUser`. Coincide con la eliminación prevista por REC-01, aplicada aquí sin copiar su PR ni sus migraciones.
- `src/services/productService.ts`, `src/services/productCatalog.ts` y `src/app/api/products/route.ts`: retornan filas reales, lista vacía válida o error explícito. No usan productos locales. Los campos obligatorios inválidos producen error; solo la imagen ausente usa placeholder. Los errores del servicio se devuelven como 503 y errores inesperados como 500, sin detalles de conexión. La ruta es dinámica y responde `Cache-Control: no-store`.
- `src/app/products/page.tsx`: hace fetch `no-store` al montar y al reintentar, aborta/desestima respuestas tras desmontaje, distingue carga/error/catálogo vacío y conserva búsqueda, filtro y orden. No deduplica por nombre: `id` conserva identidad.
- `src/lib/clientCache.ts` permanece para usos existentes de perfil/pedidos; el catálogo público ya no lo consulta. No se cambió su TTL ni la caché Redis compartida de pedidos.
- Los tres flujos Genkit del alcance conservan contratos y prompts; sus registros omiten entrada, prompt, imágenes y contenido del usuario.

## Contratos e integración

El perfil se consulta por el UUID de `session.user.id`; el rol procede solo de PostgreSQL y sirve para la UI, nunca como autorización. El navegador no inserta perfiles. El contrato es compatible con el trigger de REC-01: Auth crea el perfil con el mismo UUID y rol inicial confiable `customer`; no se lee `user_metadata.role`. La migración de REC-01 no forma parte de esta rama y no se afirma que esté aplicada en producción. El registro cambió en las mismas líneas que REC-01: se conserva únicamente `name`, por lo que la integración prevista debe mantener esa forma.

No se modificaron archivos de REC-02: checkout, carrito, pedidos, inventario ni `orderService`. Las dos aplicaciones siguen autenticándose independientemente.

## Pruebas y validación

Pruebas deterministas con Node `node:test` (dobles/lógica local, no integración contra Auth o PostgreSQL):

```powershell
cd E-commerce-Wankas
node --experimental-strip-types --test tests/rec04/rec04.test.mjs
npm run typecheck
npm run build
```

El conjunto cubre rutas válidas e inválidas, descartar resultados de perfil obsoletos, lista vacía, IDs distintos con el mismo nombre, campos corruptos, propagación de fallos/reintentos, códigos HTTP y `no-store`, eliminación y referencias del sistema heredado, metadata de registro y ausencia de entradas sensibles en logs Genkit. Resultado registrado en esta revisión: 7/7 pruebas aprobadas y `npm run typecheck` aprobado. `npm run build` compiló y generó las páginas; apareció una advertencia de dependencia opcional faltante `@opentelemetry/exporter-jaeger` desde Genkit/Opentelemetry.

No se ejecutaron pruebas reales con Supabase Auth/PostgreSQL, correos de confirmación, login correcto/incorrecto, consultas de catálogo contra la base ni una sesión con rol alterado. Estas dependen de una instancia de prueba y credenciales aisladas; no se usaron credenciales remotas ni se cambió Supabase. Tampoco se afirma que el trigger de REC-01 esté desplegado.

## Propiedad, archivos y riesgos pendientes

Los cambios se limitan a módulos REC-04, helper nuevo, pruebas y esta documentación. No se tocaron `package.json`, lockfile, Next/TypeScript config, el header, módulos comerciales o transaccionales, aplicación administrativa, SQL ni configuraciones de producción.

Riesgos verificables: confirmar en el entorno de integración que el trigger de REC-01 esté aplicado antes de dar por garantizado `profiles.id = auth.users.id`; la lectura de catálogo presupone que cada fila tiene categoría y precio/stock numéricos válidos; y el build local muestra la dependencia opcional Jaeger ausente. El formulario usa `/login` como paso después de registro sin sesión, donde el usuario puede iniciar sesión tras confirmar el correo.

## Verificación posterior a la integración

1. Aplicar y revisar REC-01 en una base aislada; verificar trigger, FK Auth/perfil y rol inicial `customer`.
2. Probar registro con confirmación habilitada y deshabilitada en un proyecto de prueba; verificar que `user_metadata.role` manipulado no altera el rol en PostgreSQL.
3. Probar login, refresh, cambio de cuenta, logout durante lectura de perfil y error de logout con Auth de prueba.
4. Crear, modificar y retirar productos en una base de prueba; verificar respuesta nueva tras recarga, IDs duplicados por nombre y estados HTTP ante indisponibilidad.
5. Ejecutar typecheck, build y el conjunto `node:test` en la rama integrada; inspeccionar los logs de los tres flujos Genkit con entradas sensibles sintéticas.
