# Cierre REC-05 — WankaFood

Fecha de validación: 11 de noviembre de 2026. Rama: `fix/wankas-integracion-despliegue`. Base auditada: `7efa5e2e034eb472582810ad53ea2af2b4d333ad`.

## 1. Objetivo y alcance

REC-05 integra catálogo, ubicaciones, resumen e informes administrativos con las API autenticadas existentes; asigna la sede del trabajador desde su perfil; aísla datos y caché entre sesiones; y prepara pruebas, operación y release. El PR #22 continúa en Draft y este trabajo no fusiona cambios ni cierra el issue #5.

## 2. Dependencias REC-01/02/03/04

- **REC-01:** autenticación Supabase, roles de perfil y `profiles.location_id` persistente; nunca se usa `user_metadata.role` para autorizar.
- **REC-02:** pedidos y existencias mantienen sus transiciones y contratos atómicos.
- **REC-03:** las API administrativas existentes, `authenticateAdmin`, `adminFetch` y `collectAdminRows` conservan sus contratos. No se modificaron sus endpoints ni SQL/RLS.
- **REC-04:** no se actualizó Genkit. La prueba de ausencia del flujo heredado continúa verificando el mismo requisito y ahora recorre fuentes con API estándar de Node.

## 3. Arquitectura administrativa final

Las pantallas del navegador usan `adminRequest`/`adminMutation` para catálogo, sedes, resumen e informes. El token llega mediante el helper de REC-03; la API vuelve a autenticarlo y consulta el rol desde `public.profiles`. Las operaciones privilegiadas usan `createAdminClient()` solo en servidor. Los errores HTTP/red se muestran como errores; no se convierten en listas vacías válidas.

El trabajador no puede administrar catálogo, sedes, resumen ni informes. El resumen redirige a pedidos. `seleccionar-sede` muestra la sede persistente de `profiles.location_id`; no ofrece selección arbitraria. El nombre visual puede requerir volver a validar el perfil tras cambios de asignación; no se modificó la pantalla de pedidos de DEV-2.

## 4. Autenticación, sede y aislamiento de caché

La identidad de caché combina el ID del usuario y los valores confiables de `role` y `location_id` obtenidos al hidratar el perfil. Cambiar identidad o perder la sesión limpia la caché. Una generación evita que lecturas antiguas repueblen datos; el componente también comprueba identidad antes de mostrar resultados. Un refresh del token de la misma identidad no cambia la clave lógica.

La hidratación del perfil usa un secuenciador: una respuesta anterior no puede restaurar al usuario A después de entrar B o cerrar sesión. `localStorage` puede conservar datos de presentación, pero no autoriza operaciones.

## 5. API de informes y métricas

Nuevo endpoint `GET /api/admin/informes`:

- Sin Bearer válido: `401`; `worker`: `403`; admin: `200` si todas las lecturas terminan correctamente.
- Autoriza antes de consultar datos de informe y no acepta identidad ni sede desde el cliente.
- Responde con `Cache-Control: private, no-store`.
- Proyecta pedidos (`id`, fecha, estado, total, nombre de sede e ítems con cantidad, `price_at_purchase`, producto y categoría) y productos (`id`, nombre y stock). No lee perfiles ni PII.
- Ordena por `id` y usa cursor estable con `collectAdminRows` en pedidos y productos. Una página fallida da `500` sin resultado parcial.
- Un `200` con arreglos vacíos representa un resultado legítimo. Los importes de categoría usan cantidad por `price_at_purchase`; no el precio actual.

El cliente conserva ventas completadas, ingresos, ticket promedio, tendencia, top de categorías/productos, rendimiento por sede, stock bajo, filtro temporal y PDF. Muestra carga, resultado válido vacío, error de autorización o error de servidor/red; permite reintentar. Limpia datos no válidos, ignora una respuesta de sesión anterior y solo habilita PDF tras cargar datos completos.

El endpoint reúne todas las filas en memoria para construir el informe. La paginación evita el truncamiento silencioso de una sola respuesta, pero el enfoque no es ilimitado: con volúmenes muy grandes, el uso de memoria, duración y límites del proyecto Supabase requieren medir y eventualmente cambiar a agregados/consultas paginadas por intervalo. No se afirma escala ilimitada.

## 6. Catálogo, sedes y resumen

- Catálogo: GET/POST/PATCH por API autenticada, validación local compatible con el contrato, reintento, errores visibles e invalidación protegida por identidad. La edición de stock sigue bloqueada por el contrato PATCH de REC-03.
- Sedes: GET/POST/PATCH por API autenticada, reintento y errores visibles. La interfaz no permite eliminar productos ni sedes: las API bloquean esas bajas por historial/integridad (`409 DELETE_BLOCKED`).
- Resumen: API autenticada solo admin, error y reintento; elimina precargas controladas por parámetros del navegador y no presenta métricas si falla la API.

## 7. Instalación reproducible y pruebas

Entorno ejecutado: Node `v24.3.0`, npm `11.4.2`. `npm ci` terminó correctamente en las dos carpetas. El lockfile de Administración incluye Playwright como dependencia de desarrollo para las pruebas preparadas; el lockfile de E-commerce no cambió.

Comandos ejecutados:

| Aplicación | Comando | Resultado real |
|---|---|---|
| Administración | `npm test` | ✅ 113 pruebas CJS + 53 pruebas TypeScript; 166/166 en la ejecución final |
| Administración | `npm run typecheck` | ✅ `tsc --noEmit`, 0 errores |
| Administración | `npm run lint` | ✅ 0 errores; quedan 5 warnings preexistentes fuera de REC-05 |
| Administración | `npm run build` con configuración ficticia local de Supabase | ✅ Next 15.5.29; tipos y lint durante build; 17 rutas |
| E-commerce | `node --test` | ✅ 20/20; incluye prueba portable REC-04 |
| E-commerce | `npm run typecheck` | ✅ `tsc --noEmit`, 0 errores |
| E-commerce | `npm run lint` | ✅ 0 errores; 15 warnings no bloqueantes |
| E-commerce | `npm run build` | ✅ Next 15.5.29; 13 rutas |
| Ambas | `npm audit --omit=dev` | ⚠️ no pasa: 48 vulnerabilidades por app: 22 altas, 25 moderadas, 1 baja, 0 críticas |

El primer build de Administración, sin variables locales, falló al prerender `/dashboard/ubicaciones` porque faltaba `NEXT_PUBLIC_SUPABASE_URL`. El build posterior pasó con URL y claves de marcador de prueba (no reales); no conectó a una base. E-commerce construyó sin variables y avisó que algunas funciones de Supabase no estarían disponibles durante el build.

Los dos builds muestran warnings de dependencias, incluyendo análisis dinámico de Supabase Realtime y referencias transitivas de Genkit/OpenTelemetry. No se aplicó `npm audit fix` ni se migró Next o Genkit. Genkit permanece en `1.8.0`; el audit señala, entre otros, dependencias de Genkit/OpenTelemetry y Zod, y varias dependencias transitivas con corrección disponible. No se adjudica la reducción de vulnerabilidades que no haya ocurrido.

`eslint.ignoreDuringBuilds` se retiró de ambas configuraciones después de que `npm run lint` terminara con 0 errores. Los avisos no bloquean lint/build. Los arreglos mecánicos de ESLint se limitaron a la lista autorizada del mandato.

En Node 24.3.0, el argumento literal `node --test tests/` produjo un error del runner al resolver el directorio en Windows. `node --test` (descubrimiento nativo de archivos) sí ejecutó E-commerce y pasó 20/20; Administración ajustó su script `npm test` para usar `tests/*.test.cjs` y pasó junto a TypeScript.

### Cobertura de los dobles añadidos

`tests/admin-informes-route.test.cjs` cubre 401 anónimo, 403 worker, 200 admin, lectura multipágina, tablas vacías, error primera/página posterior, proyección sin PII y precios históricos. `src/lib/adminCache.test.ts` y `src/lib/reportRequestState.test.ts` cubren cambio de identidad, logout, refresh de token estable, cambio de rol/sede, rechazo de respuesta anterior y elegibilidad del PDF.

Las pruebas usan dobles; no consultan ni escriben en Supabase real. No hubo prueba funcional en navegador, simulación de Vercel, ni E2E con cuentas reales.

## 8. Procedimiento de validación funcional pendiente

En un entorno aislado y con cuentas de prueba autorizadas, validar admin en catálogo, sedes, resumen e informes; worker con y sin sede y sin acceso a otra sede; usuario anónimo y sesión expirada; pérdida de red/Supabase; cambio de identidad con peticiones en vuelo; y PDF tras carga correcta y tras error. Comprobar también que la asignación de sede se refleja después de revalidar el perfil.

**Pendiente:** no se proporcionaron cuentas admin/worker de prueba ni se verificó una base aislada. Las variables locales históricas apuntan a una base real compartida; no se usó para crear, cambiar ni borrar datos. Los dobles no se presentan como evidencia E2E.

## 9. Configuración Vercel observada (solo lectura)

Consultado el 11-11-2026 por Vercel CLI 64.3.1 y el conector de lectura. Equipo: `marecahu02-9205s-projects` (plan Hobby). Proyectos conectados al repositorio `mrcastilla8/deploy-wankas`:

| Proyecto | Root Directory | Rama Production | Git deployments | Autoasignación de dominios |
|---|---|---|---|---|
| `admin-wankas` | `Administrador-Wankas` | `main` | enabled | enabled |
| `ecommerce-wankas` | `E-commerce-Wankas` | `main` | enabled | enabled |

Ambos proyectos usan Next.js, Node 24.x y despliegues Git. En la lista de dominios aparecen los dominios Vercel de cada proyecto; no aparecen `wankas.antiglitch.dev` ni `admin.wankas.antiglitch.dev`. Los proyectos tienen `gitForkProtection` activado. Los checks se consultaron con `vercel project checks`: ambos devuelven cero configurados.

Hay previews `READY` para el SHA auditado `7efa5e2e034eb472582810ad53ea2af2b4d333ad` en ambos proyectos, con target Preview y alias único de rama. La última producción observada en ambos es `READY` desde `main` en `63ebf4c74f96ac9c9d167f9a499e73c16bfc3d82`; su target es `production` y ya tiene aliases automáticos asignados. Esto constata el comportamiento existente, no prueba una política de publicación segura.

Tras el push REC-05, Vercel creó previews desde `fix/wankas-integracion-despliegue` para `8c106a13a4af952279437e0969ea7b48d46087cb`: `admin-wankas` (`dpl_6RRDgcNMQVW7ApVSYrj3wChu1ekw`) y `ecommerce-wankas` (`dpl_CAVAGMCg4LMFEejAuKDhRxKkdmuo`) llegaron a `READY`, target Preview, con alias único por deployment. No se asignó alias de Production.

### Qué ocurrirá al fusionar PR #22

Con la configuración observada, el merge actualiza `main`; Vercel tiene despliegues Git habilitados y producción sigue `main`. Los cambios afectan las dos carpetas raíz. Vercel creará los despliegues de Production correspondientes y, como la autoasignación está habilitada y no hay checks, podrá asignar aliases/dominios productivos al quedar listos. Mantener el PR en Draft no constituye una barrera de Vercel una vez que se fusione.

### Control propuesto, sin aplicar

Antes del merge, configurar Deployment Checks de Production para que un check requerido de GitHub represente la CI completa (typecheck, lint, pruebas, build y revisión del audit acordada). Los checks mantienen el build de Vercel y retienen la asignación de dominios hasta su aprobación. El check nativo de lint/typecheck no reemplaza la suite ni los criterios de seguridad. No usar Force Promote para saltar una falla. La alternativa de release por CI es generar un deployment de Production staged con `vercel deploy --prod --skip-domain`, probar ese deployment y promover ese mismo build después de aprobación.

Las herramientas de solo lectura confirmaron que actualmente no hay checks. No se verificó en la cuenta Hobby la configuración efectiva de Deployment Checks, su integración/check reporter ni una prueba controlada de bloqueo; no se cambió Vercel. Por lo tanto:

**BLOQUEO DE MERGE: CONTROL DE PUBLICACIÓN NO VERIFICADO**

Referencias oficiales: [Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration), [Deployment Checks](https://vercel.com/docs/deployment-checks), [Deployments y promoción](https://vercel.com/docs/deployments/promoting-a-deployment), [Vercel CLI](https://vercel.com/docs/cli).

Dominios previstos, sin configurar: `wankas.antiglitch.dev` y `admin.wankas.antiglitch.dev`.

## 10. Despliegue controlado y reversión

1. Mantener PR #22 en Draft mientras no pase el control de publicación y la auditoría funcional externa.
2. En previews de ambos proyectos, probar el SHA exacto con datos/cuentas aislados; registrar commit, entorno y resultado. Preview READY por sí solo no autoriza promoción.
3. Una vez verificado el check de Production, acordar el merge y revisar el deployment asociado antes de asignar tráfico.
4. Si el flujo staged es aprobado, probar el deployment Production sin alias y promover ese mismo deployment, no reconstruir un preview con variables de Production.

**Rollback de código:** revertir el commit/merge en Git y publicar la reversión mediante el flujo autorizado. `git revert` no mueve por sí solo los dominios productivos a un deployment anterior.

**Rollback de tráfico:** usar la función `vercel rollback`/Vercel para apuntar el proyecto al deployment Production previo elegido, y verificar respuesta/aliases de cada proyecto. Los dos proyectos se revierten de forma independiente. La reversión de tráfico no revierte commits Git y Vercel indica que rollback detiene la autoasignación de nuevos dominios; revisar cómo reanudarla antes de la siguiente publicación. No se ha ejecutado rollback.

No hay migraciones REC-05 ni escrituras de datos, por lo que el cambio no requiere restauración de base de datos. Si un cambio posterior introduce migraciones, su compatibilidad y reversión deben documentarse por separado.

## 11. Riesgos residuales y bloqueos

- **Control de publicación sin verificar:** bloquea el merge hasta establecer y comprobar una barrera para Production.
- **E2E funcional pendiente:** faltan cuentas de prueba autorizadas y entorno Supabase aislado.
- **22 hallazgos altos de auditoría por app:** 0 críticos, pero la auditoría de dependencias de producción no pasa. Genkit sigue en su versión REC-04; resolver sus dependencias corresponde coordinar con ese ámbito.
- **Volumen de informes:** todo el conjunto se pagina y materializa en memoria; establecer umbrales operativos antes de crecimiento alto.
- **Warnings de ESLint/build:** permanecen avisos ajenos al alcance en pedidos/REC-03 y dependencias; cero errores de lint y builds locales completos.
- **Previews no son aprobación productiva:** el SHA de implementación `8c106a1` quedó READY en ambos proyectos Preview; el equipo aún debe verificar el control que retiene la asignación de dominios de Production.

## 12. Criterios de aceptación y estado

| Criterio | Estado |
|---|---|
| Informes pasan por API autenticada con admin-only, proyecciones mínimas y no-store | ✅ Implementado y probado con dobles |
| Paginación completa y fallo cerrado sin estadísticas parciales | ✅ Implementado y probado con dobles |
| Métricas conservan `price_at_purchase`; carga/error/vacío/reintento/PDF | ✅ Implementado; lógica cubierta parcialmente con dobles |
| Aislamiento de caché y perfil entre identidades, logout y respuestas tardías | ✅ Implementado; caché, controller de informes y patrones de pedidos probados con dobles |
| Catálogo, sedes y dashboard usan API y exponen errores reales | ✅ Implementado; build y TypeScript pasan |
| Worker solo ve su sede confiable; sin sede no elige sede | ✅ Interfaz conserva `profiles.location_id`; el E2E sigue pendiente |
| Recorte de ESLint autorizado y `ignoreDuringBuilds` retirado | ✅ 0 errores; warnings pendientes listados arriba |
| Prueba REC-04 portable, con aserción preservada | ✅ 20/20 pasó en Node 24.3.0 |
| `npm ci`, TypeScript, lint, tests y build reproducibles en ambas apps | ✅ salvo audit de seguridad; build Admin requiere config local, probado con placeholders |
| `npm audit --omit=dev` sin críticas/altas | ❌ 22 altas por app; audit no pasa |
| Pruebas funcionales positivas/negativas en navegador con cuentas aisladas | ⏳ Pendiente: cuentas y entorno aislado no disponibles |
| Control Vercel que impide promoción automática hasta validar | ❌ **BLOQUEO DE MERGE: CONTROL DE PUBLICACIÓN NO VERIFICADO** |
| PR #22 Draft, issue #5 abierto, sin merge ni cambios de plataforma | ✅ Estado mantenido |

## Revalidación de carreras y preparación E2E — 11 de noviembre de 2026

Esta revalidación parte del SHA auditado `5eab45140783cfa330a1f8337ae928300890e093`. Los resultados corresponden a la revisión local antes de publicar este seguimiento:

- `adminRequest` captura la generación de identidad antes de la red y solo invalida caché si la identidad original sigue vigente. La prueba con A/B y respuestas diferidas confirma que el 401 atrasado de A no altera la generación ni la caché de B, y que la petición válida de B concluye.
- `AuthOperationGate` proporciona una vigencia compartida para `getSession`, eventos, login y logout; los eventos vuelven a leer la sesión actual antes de hidratar perfil. Se probaron inicio A obsoleto ante SIGNED_IN B, login pendiente seguido de logout, renovación, sesión nula y desmontaje con dobles.
- `parseReportPayload` valida en runtime campos requeridos, relaciones y números finitos. Un HTTP 200 JSON incompleto lanza error y no llega al estado de informe cargado.
- Administración: `npm ci` pasó. TypeScript pasó. `npm test`: 166 pruebas (113 CJS + 53 TS), todas pasaron. ESLint: 0 errores y 5 advertencias existentes. Build Next 15.5.29 pasó con marcadores locales no secretos para URL/keys; el build reporta advertencia de dependencia dinámica de Supabase Realtime.
- E-commerce: `npm ci` pasó. TypeScript pasó. ESLint: 0 errores y 15 advertencias. Los archivos de test explícitos pasaron 20/20. El comando `node --test tests/` falló en Windows/Node 24.3.0 al interpretar `tests/` como módulo; la ejecución equivalente con los tres archivos enumerados pasó. Build pasó sin variables Supabase de E-commerce, con advertencias de tracing Genkit/handlebars y una dependencia opcional `@opentelemetry/exporter-jaeger` ausente; Genkit se conservó sin actualizar.
- `npm audit --omit=dev` falló en ambas aplicaciones con 48 vulnerabilidades (22 altas, 25 moderadas, 1 baja, 0 críticas). `npm ci` reportó 71 en el árbol completo (30 altas, 36 moderadas, 4 bajas, 1 crítica), incluyendo dependencias de desarrollo. No se afirma un audit exitoso.
- No se ejecutó Playwright ni smoke test real. `docs/rec05-e2e-preparacion.md` enumera solo nombres/propósitos/entornos de variables y los procedimientos separados: mutaciones de catálogo interceptadas con fixtures, y smoke solo GET que rechaza escrituras. No se recibió ni inspeccionó secreto alguno; no se tocó Wankas New.
- Marco verificó en Vercel que los previews de `admin-wankas` y `ecommerce-wankas` para el SHA auditado `ae3d4640e779142507c88645dcbde1b3551d47d6` están ambos `READY` con target Preview. Esta evidencia confirma los previews de ese SHA; no autoriza producción ni resuelve el control de promoción automática a `main`.

Las advertencias de builds, el audit fallido y la ausencia de sesión aislada para navegador quedan como riesgos/bloqueos de validación, sin modificar producción, Vercel, Supabase, RLS ni SQL.
