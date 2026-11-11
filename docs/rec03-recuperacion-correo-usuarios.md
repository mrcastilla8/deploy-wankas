# Recuperar un cambio de correo interrumpido en REC-03

Un cambio de correo reserva el valor nuevo en `public.profiles` antes de solicitar el cambio a Supabase Auth. Si el proceso se interrumpe entre ambas escrituras, `PATCH /api/admin/usuarios` devuelve `409 USER_EMAIL_CONFLICT` en los intentos siguientes. El procedimiento recupera el perfil a partir del correo confirmado de Auth para el mismo UUID. Después se puede volver a solicitar el cambio deseado desde el panel.

## Diagnóstico

1. Confirma el proyecto Supabase y el UUID afectado. Si se perdió la respuesta de PostgreSQL después de guardar, la solicitud puede devolver `500 INTERNAL_SERVER_ERROR` y registrar `Could not confirm profile email reservation` con el UUID. Si se envió la escritura a Auth y su resultado quedó indeterminado, busca `500 USER_UPDATE_ROLLBACK_FAILED` y `Auth email change needs reconciliation`.
2. Ejecuta el diagnóstico desde `Administrador-Wankas` con `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` cargadas en el entorno seguro del operador. Usa la URL verificada del proyecto como argumento, sin incluir credenciales.

   ```sh
   node scripts/reconcile-user-email.cjs --project-url https://PROYECTO.supabase.co --user-id UUID
   ```

   `aligned` indica que Auth y el perfil ya coinciden. `mismatch` indica que difieren. El diagnóstico solo lee el estado y muestra el UUID y el resultado.

## Aplicar la reconciliación

1. Pausa los cambios de correo para esa cuenta en todas las instancias y vías que escriban en Auth o `profiles`. Si la pausa por cuenta no está disponible, pausa los procesos que aceptan esos cambios en el proyecto. Espera a que terminen las operaciones en curso. Si hubo una respuesta indeterminada de Auth, confirma mediante los registros del proyecto que la solicitud anterior terminó. Si no se puede confirmar, conserva el bloqueo y continúa la investigación. Dos lecturas iguales por sí solas no demuestran que la escritura pendiente haya terminado.
2. Con las escrituras pausadas, ejecuta el mismo comando con `--apply`.

   ```sh
   node scripts/reconcile-user-email.cjs --project-url https://PROYECTO.supabase.co --user-id UUID --apply
   ```

   El comando vuelve a leer ambos registros, escribe únicamente `email` y `updated_at` del perfil y exige que coincidan el UUID, el correo previo y la versión leída. `reconciled` confirma que la relectura de ambos registros coincide con el correo de Auth. Si la fila cambió o se perdió la respuesta de esta escritura, vuelve al diagnóstico con las escrituras aún pausadas. Un resultado `aligned` después de una respuesta perdida confirma el estado actual.
3. Reanuda las ediciones cuando el diagnóstico indique `aligned` o la operación devuelva `reconciled`. Si el cambio inicial sigue autorizado, vuelve a solicitarlo desde el panel.

Desde `Administrador-Wankas`, ejecuta `node --test tests/admin-usuarios.test.cjs` para probar el procedimiento con Supabase simulado. Los casos cubren la pérdida de la respuesta de PostgreSQL después de persistir la reserva, la pérdida de la respuesta de la propia reconciliación, la recuperación tras un resultado indeterminado de Auth una vez terminado el intento previo y el rechazo si la versión del perfil cambia durante la reconciliación.
