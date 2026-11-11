# Paginación y consistencia de las API administrativas de REC-03

Los GET de `/api/admin/pedidos`, `/api/admin/usuarios` y `/api/admin/catalogo` recorren PostgREST por lotes de hasta 500 filas, ordenados por UUID y con un cursor exclusivo sobre el último `id`. Una página corta puede deberse al límite configurado en Supabase. El recorrido termina al recibir una página vacía. Si falla una página, la API devuelve `500` y descarta todo el resultado de esa solicitud.

El contrato HTTP se conserva para los consumidores de REC-02 y REC-05. Pedidos y usuarios devuelven un arreglo. Catálogo devuelve `{ products, categories }` y pagina ambas tablas. Los pedidos se presentan del más reciente al más antiguo, los usuarios por nombre y los productos por nombre. Cada página de pedidos para un trabajador aplica la sede obtenida del perfil autenticado. El recorrido usa varias consultas y puede observar cambios concurrentes en PostgreSQL.

Redis es opcional para los GET de catálogo, ubicaciones y dashboard. Las rutas autentican y autorizan antes de consultar la caché. Los GET de pedidos y usuarios consultan PostgreSQL directamente.

- Tras una mutación confirmada, la API espera la rotación de la versión correspondiente en Redis. Si se confirma la invalidación, los GET posteriores que consultan Redis usan la nueva versión. Las lecturas que ya habían elegido la versión anterior solo pueden escribir en la versión anterior.
- Si falla la invalidación, la respuesta de la mutación conserva el éxito confirmado por PostgreSQL. Una lectura de Redis puede servir una entrada anterior hasta su vencimiento original. El plazo máximo es de cinco minutos desde la lectura del reloj de Redis, que ocurre antes de consultar PostgreSQL. Los aciertos y los resultados que llegan tarde conservan ese plazo. Una lectura que ya estaba en curso puede entregar su resultado al solicitante original, incluso si el resultado llega demasiado tarde para que otro GET pueda obtenerlo de Redis.
- Si falla una lectura de Redis, la API consulta PostgreSQL. Las entradas usan expiración absoluta con `SET PXAT` (Redis 6.2 o posterior). Si Redis no admite el reloj o la expiración requeridos, se sirve la respuesta de PostgreSQL sin guardar esa lectura. El prefijo de la caché separa estas entradas de las versiones anteriores.

La garantía cubre los GET del servidor. REC-05 mantiene el caché del navegador y la recarga en sus pantallas. La validación conjunta de permisos, datos y transiciones en Supabase de pruebas depende de REC-01 y REC-02.
