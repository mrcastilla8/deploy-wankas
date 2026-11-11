import { adminFetch } from './adminFetch'
import { adminCache } from './adminCache'

/**
 * Cliente de las API administrativas (REC-05).
 *
 * Usa `adminFetch` (REC-03) para enviar el Bearer token, comprueba `response.ok`
 * y convierte cualquier fallo en `AdminApiError`. Nunca devuelve una colección
 * vacía en lugar de un error.
 */

export type AdminFetcher = (path: string, init?: RequestInit) => Promise<Response>

export class AdminApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(`Admin API ${status} ${code}`)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code
  }

  /** 401 o 403: la sesión ya no autoriza la operación. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/** Estado usado cuando la petición no llegó a recibir respuesta HTTP. */
export const NETWORK_ERROR_STATUS = 0

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Cuerpo vacío o no JSON: se usa el código genérico.
  }
  return 'UNKNOWN_ERROR'
}

export async function adminRequest<T>(
  path: string,
  init?: RequestInit,
  fetcher: AdminFetcher = adminFetch,
): Promise<T> {
  // La generación se captura antes de esperar la red para que un error tardío
  // de una sesión anterior no pueda invalidar la caché de la identidad actual.
  const requestIdentityGeneration = adminCache.getIdentityGeneration()
  let response: Response
  try {
    response = await fetcher(path, init)
  } catch {
    throw new AdminApiError(NETWORK_ERROR_STATUS, 'NETWORK_ERROR')
  }

  if (!response.ok) {
    const error = new AdminApiError(response.status, await readErrorCode(response))
    // La vista actual recibe el error; la invalidación solo afecta a la sesión
    // que originó la petición y únicamente si aún sigue activa.
    if (error.isAuthError) adminCache.invalidateForIdentityGeneration(requestIdentityGeneration)
    throw error
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new AdminApiError(response.status, 'INVALID_RESPONSE')
  }
}

/** Envía un cuerpo JSON con el método indicado. */
export function adminMutation<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  fetcher: AdminFetcher = adminFetch,
): Promise<T> {
  return adminRequest<T>(
    path,
    { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    fetcher,
  )
}

/** Mensaje para el usuario según el estado y el código devueltos por la API. */
export function describeAdminError(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return 'Ocurrió un error inesperado. Inténtalo de nuevo.'
  }
  if (error.code === 'DELETE_BLOCKED') {
    return 'La eliminación está deshabilitada para proteger el historial de pedidos.'
  }
  if (error.code === 'INTEGRITY_CONFLICT') {
    return 'La operación entra en conflicto con datos existentes (por ejemplo, un registro duplicado o en uso).'
  }
  switch (error.status) {
    case NETWORK_ERROR_STATUS:
      return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
    case 400:
      return 'Los datos enviados no son válidos. Revisa el formulario.'
    case 401:
      return 'Tu sesión expiró. Vuelve a iniciar sesión.'
    case 403:
      return 'No tienes permisos para realizar esta acción.'
    case 404:
      return 'El registro ya no existe. Actualiza la página.'
    case 409:
      return 'La operación no se pudo completar por un conflicto con el estado actual.'
    default:
      return 'El servidor no pudo completar la operación. Inténtalo más tarde.'
  }
}
