# REC-05: preparación de pruebas de navegador

Este documento prepara pruebas de interfaz para un entorno local o de staging aislado. No contiene valores de configuración ni credenciales. No ejecutar pruebas mutables contra Wankas New, producción ni una base compartida.

## Inventario de variables

| Nombre | Propósito | Entorno |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase usado por la aplicación | Administración y E-commerce, local/staging aislado |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública para Auth y las operaciones de usuario del cliente | Administración y E-commerce, local/staging aislado |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso privilegiado del servidor de Administración para las API admin | Administración, únicamente local/staging aislado; nunca navegador |
| `NEXT_PUBLIC_ECOMMERCE_URL` | URL de tienda enlazada desde Administración | Administración, local/staging |
| `NEXT_PUBLIC_ADMIN_URL` | URL administrativa enlazada desde E-commerce | E-commerce, local/staging |
| `E2E_ADMIN_EMAIL` | Identidad admin autorizada para autenticar la prueba con mocks | Administración, proyecto Supabase aislado |
| `E2E_ADMIN_PASSWORD` | Secreto de autenticación de esa identidad de prueba | Administración, proyecto Supabase aislado |
| `PLAYWRIGHT_BASE_URL` | Origen local o de staging que abrirá Playwright | Administración, local/staging |
| `PLAYWRIGHT_STORAGE_STATE` | Ruta local ignorada por Git al estado de sesión de smoke read-only | Administración, local/staging aislado |

Los valores se cargan directamente en el entorno del runner por quien opera el entorno. No guardarlos en el repositorio, artefactos de CI, logs, capturas ni chat. `SUPABASE_SERVICE_ROLE_KEY` no se requiere para los specs del navegador si las rutas API están interceptadas.

## Prueba de navegador con mocks de escritura

Archivo: `Administrador-Wankas/e2e/catalogo-write-mocks.spec.ts`.

1. Preparar variables de cliente con un proyecto Supabase desechable y una cuenta admin de ese proyecto.
2. Iniciar Administración localmente, con sus variables de servidor aisladas si se requieren para la carga inicial.
3. Instalar Chromium con `npx playwright install chromium` en el runner preparado.
4. Ejecutar `npm run test:e2e:mock` desde `Administrador-Wankas`.
5. El spec intercepta `GET/POST/PATCH /api/admin/catalogo` con fixtures; cualquier otra escritura bajo `/api/admin/**` devuelve `405` y no se envía al backend. Comprueba alta y edición de un producto de fixture.

El inicio de sesión se realiza contra el proyecto de prueba configurado por el operador, nunca contra Wankas New. Las mutaciones de catálogo son respuestas de navegador simuladas y no persisten.

## Smoke test exclusivamente de lectura

Archivo: `Administrador-Wankas/e2e/readonly-smoke.spec.ts`.

1. Usar un proyecto de staging autorizado con datos no sensibles, o local.
2. Preparar `PLAYWRIGHT_STORAGE_STATE` fuera del repositorio. La sesión debe pertenecer a un admin de ese mismo entorno.
3. Definir `PLAYWRIGHT_BASE_URL` al origen del entorno elegido e instalar Chromium.
4. Ejecutar `npm run test:smoke:readonly` desde `Administrador-Wankas`.
5. La prueba visita catálogo, ubicaciones e informes. Solo deja continuar `GET /api/admin/**`; rechaza con `405` cada otro método y falla si detecta una tentativa de escritura.

No usar como smoke test una cuenta/URL de producción ni una cuenta del proyecto Wankas New. Este procedimiento no se ejecutó durante el cierre porque no se proporcionó un proyecto aislado con sesión de prueba; las specs quedaron preparadas, no se presentan como E2E ejecutadas.
