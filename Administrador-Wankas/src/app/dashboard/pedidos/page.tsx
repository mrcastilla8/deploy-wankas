
"use client"

import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import type { Order, OrderStatus, Location } from "@/types"
import { orderStatusToSpanish, spanishToOrderStatus } from "@/types"
import { adminFetch } from "@/lib/adminFetch"
import { adminCache } from "@/lib/adminCache"
import {
  createRequestSequencer,
  initialOrdersState,
  isSameSession,
  ordersReducer,
  selectIsOrdersLoading,
  selectVisibleOrders,
  type RequestSequencer,
} from "@/lib/pedidosState"
import { Loader } from "@/components/ui/loader"
import { format, parseISO } from "date-fns"
import { es } from 'date-fns/locale'

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar } from "@/components/ui/calendar"
import { MoreHorizontal, Filter, Calendar as CalendarIcon } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function PedidosPage() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const [ordersState, dispatchOrders] = React.useReducer(
    ordersReducer<Order>,
    initialOrdersState<Order>()
  )
  const [locations, setLocations] = React.useState<Location[]>([])
  const [activeTab, setActiveTab] = React.useState<string>("Todos")

  const updatingOrderId = ordersState.updatingOrderId

  const [locationFilter, setLocationFilter] = React.useState<string>("all")
  const [searchTerm, setSearchTerm] = React.useState("")
  const [dateFilter, setDateFilter] = React.useState<Date | undefined>()

  const statuses: string[] = ["Todos", "Pendiente", "Completado", "Cancelado"]

  // Identidad de la sesión actual: cualquier cambio invalida datos en vuelo.
  const sessionIdentity = React.useMemo(
    () => (user ? `${user.id}:${user.role}:${user.location_id ?? 'all'}` : null),
    [user]
  )
  // Se sincroniza en el render para que una respuesta asíncrona pueda comparar
  // contra la identidad vigente sin esperar a los efectos.
  const sessionIdentityRef = React.useRef<string | null>(null)
  sessionIdentityRef.current = sessionIdentity
  // Última identidad ya invalidada, para no repetir la limpieza en cada render.
  const invalidatedIdentityRef = React.useRef<string | null>(null)

  // GET y PATCH tienen secuencias independientes: una lectura intermedia no
  // puede invalidar la reconciliación de una mutación confirmada.
  const sequencerRef = React.useRef<RequestSequencer | null>(null)
  if (sequencerRef.current === null) {
    sequencerRef.current = createRequestSequencer()
  }
  const sequencer = sequencerRef.current

  // Una respuesta solo puede tocar el estado si pertenece a la solicitud más
  // reciente de su dominio y a la sesión vigente.
  const isCurrentGet = React.useCallback(
    (requestId: number, identity: string) =>
      sequencer.isCurrentGet(requestId) &&
      isSameSession(identity, sessionIdentityRef.current),
    [sequencer]
  )

  const isCurrentPatch = React.useCallback(
    (requestId: number, identity: string) =>
      sequencer.isCurrentPatch(requestId) &&
      isSameSession(identity, sessionIdentityRef.current),
    [sequencer]
  )

  const invalidateOrders = React.useCallback(
    (reason: 'identity-changed' | 'auth-error') => {
      const requestId = sequencer.invalidate()
      dispatchOrders({ type: reason, requestId })
      setLocations([])
      adminCache.invalidateAll()
    },
    [sequencer]
  )

  const handleAuthError = React.useCallback((status: number) => {
    if (status === 401) {
      invalidateOrders('auth-error')
      toast({
        variant: "destructive",
        title: "Sesión no válida",
        description: "Vuelve a iniciar sesión para continuar.",
      })
      return true
    }

    if (status === 403) {
      invalidateOrders('auth-error')
      toast({
        variant: "destructive",
        title: "Sin permiso",
        description: "No tienes autorización para ver o modificar estos pedidos.",
      })
      return true
    }

    return false
  }, [invalidateOrders, toast])

  const fetchData = React.useCallback(async () => {
    if (authLoading || !user || !sessionIdentity) {
      return
    }

    const identity = sessionIdentity

    // Cada lectura recibe un identificador de su propia secuencia: las
    // respuestas de una sesión anterior o de una lectura superada se descartan.
    const requestId = sequencer.startGet()
    dispatchOrders({ type: 'request-started', requestId })

    try {
      // Revalida la sesión con el servidor antes de mostrar cualquier dato.
      // La caché de pedidos nunca se pinta sin esta comprobación.
      const res = await adminFetch('/api/admin/pedidos')

      if (!isCurrentGet(requestId, identity)) return

      if (handleAuthError(res.status)) {
        return
      }

      if (!res.ok) {
        throw new Error(`No se pudieron cargar los pedidos (HTTP ${res.status}).`)
      }

      const ordersData = await res.json()

      if (!isCurrentGet(requestId, identity)) return

      dispatchOrders({
        type: 'request-succeeded',
        requestId,
        identity,
        orders: ordersData,
      })

      if (user.role === 'admin') {
        try {
          const cachedLocations = adminCache.get<Location[]>('ubicaciones')
          if (cachedLocations) {
            setLocations(cachedLocations)
          } else {
            const locRes = await adminFetch('/api/admin/ubicaciones')

            if (!isCurrentGet(requestId, identity)) return

            if (handleAuthError(locRes.status)) {
              return
            }

            if (!locRes.ok) {
              throw new Error(`No se pudieron cargar las ubicaciones (HTTP ${locRes.status}).`)
            }

            const locsData = await locRes.json()

            if (!isCurrentGet(requestId, identity)) return

            adminCache.set('ubicaciones', locsData)
            setLocations(locsData)
          }
        } catch (locationError) {
          if (!isCurrentGet(requestId, identity)) return
          toast({
            variant: "destructive",
            title: "Error",
            description: locationError instanceof Error
              ? locationError.message
              : "No se pudieron cargar las ubicaciones.",
          })
          console.error("Error fetching locations:", locationError)
        }
      } else {
        setLocations([])
      }
    } catch (e) {
      if (!isCurrentGet(requestId, identity)) return

      dispatchOrders({ type: 'request-failed', requestId, identity })

      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "No se pudieron cargar los pedidos.",
      })
      console.error("Error fetching orders:", e)
    }
  }, [authLoading, user, sessionIdentity, isCurrentGet, handleAuthError, toast])

  // Al cambiar de sesión se limpia el estado y se invalidan las respuestas
  // pendientes de la sesión anterior (GET y PATCH). El render ya bloquea los
  // datos ajenos mediante `selectVisibleOrders`, sin esperar a este efecto.
  React.useEffect(() => {
    if (invalidatedIdentityRef.current === sessionIdentity) return

    invalidatedIdentityRef.current = sessionIdentity
    invalidateOrders('identity-changed')
  }, [sessionIdentity, invalidateOrders])

  React.useEffect(() => {
    if (authLoading || !user) return

    fetchData()
  }, [authLoading, user, fetchData])

  const clearFilters = () => {
    setLocationFilter("all");
    setSearchTerm("");
    setDateFilter(undefined);
  };

  // La visibilidad se decide en el render, no en un efecto: si la identidad que
  // produjo los pedidos no es la de la sesión actual, se pinta una lista vacía.
  const visibleOrders = React.useMemo(
    () => selectVisibleOrders(ordersState, sessionIdentity),
    [ordersState, sessionIdentity]
  )

  const showOrdersLoader = React.useMemo(
    () => authLoading || selectIsOrdersLoading(ordersState, sessionIdentity),
    [authLoading, ordersState, sessionIdentity]
  )

  const filteredOrders = React.useMemo(() => {
    let tempOrders = visibleOrders

    if (activeTab !== "Todos") {
      const statusInEnglish = spanishToOrderStatus(activeTab)
      tempOrders = tempOrders.filter(order => order.status === statusInEnglish)
    }

    if (user?.role === 'admin' && locationFilter !== 'all') {
      tempOrders = tempOrders.filter(order => order.location_id === locationFilter)
    }

    if (searchTerm) {
      tempOrders = tempOrders.filter(order => order.id.toLowerCase().includes(searchTerm.toLowerCase()))
    }
    
    if (dateFilter) {
      tempOrders = tempOrders.filter(order => {
        if (!order.created_at) return false
        const createdAt = parseISO(order.created_at)
        if (Number.isNaN(createdAt.getTime())) return false
        return format(createdAt, 'yyyy-MM-dd') === format(dateFilter, 'yyyy-MM-dd')
      })
    }

    return tempOrders
  }, [visibleOrders, activeTab, locationFilter, user?.role, searchTerm, dateFilter])

  const handleStatusChange = async (order: Order, newStatusSpanish: string) => {
    const newStatus = spanishToOrderStatus(newStatusSpanish);
    const oldStatus = order.status as OrderStatus;

    if (!newStatus || newStatus === oldStatus) {
      return;
    }

    if (oldStatus !== 'pending') {
      toast({
        variant: "destructive",
        title: "Acción no permitida",
        description: "Solo los pedidos pendientes pueden cambiar de estado.",
      });
      return;
    }

    if (updatingOrderId) {
      return;
    }

    const identity = sessionIdentity

    if (!identity) {
      return;
    }

    // El PATCH tiene su propia secuencia: un GET intermedio de la misma sesión
    // no lo invalida. Solo un cambio de sesión, un 401/403 o otro PATCH lo hace.
    const requestId = sequencer.startPatch()
    dispatchOrders({ type: 'patch-started', requestId, orderId: order.id })

    try {
      const res = await adminFetch('/api/admin/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          new_status: newStatus,
        }),
      });

      // Respuesta de una sesión anterior: no toca estado, ni notifica, ni recarga.
      if (!isCurrentPatch(requestId, identity)) {
        return;
      }

      if (handleAuthError(res.status)) {
        return;
      }

      if (res.status === 409) {
        toast({
          variant: "destructive",
          title: "Pedido desactualizado",
          description: "El pedido ya no permite esa transición. Se recargará la lista.",
        });
        await fetchData();
        return;
      }

      if (!res.ok) {
        let message = `No se pudo actualizar el pedido (HTTP ${res.status}).`;

        try {
          const payload = await res.json();
          if (payload?.error) message = payload.error;
        } catch {
          // La respuesta de error no traía JSON.
        }

        throw new Error(message);
      }

      toast({
        title: "Éxito",
        description: newStatus === 'completed'
          ? "Pedido completado. El stock ya estaba reservado."
          : "Pedido cancelado y stock devuelto.",
      });
      await fetchData();
    } catch (e) {
      if (!isCurrentPatch(requestId, identity)) {
        return;
      }

      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "No se pudo actualizar el pedido.",
      });
      console.error('Error updating order status:', e);
    } finally {
      // El reducer ignora el token si la sesión ya cambió o si hay un PATCH más
      // reciente; así un PATCH viejo no limpia el spinner del actual.
      dispatchOrders({ type: 'patch-finished', requestId })
    }
  };

  const getStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500'
      case 'completed': return 'bg-green-500'
      case 'cancelled': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  if (showOrdersLoader) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text="Cargando pedidos..." size={48} />
      </div>
    )
  }
  
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-headline">Gestión de Pedidos</h1>
        <p className="text-muted-foreground">
          {user?.role === 'admin' ? 'Supervisa todos los pedidos.' : `Pedidos para ${user?.locationName || 'tu ubicación'}.`}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center">
            <TabsList>
                {statuses.map(status => (
                    <TabsTrigger key={status} value={status}>{status}</TabsTrigger>
                ))}
            </TabsList>
            <div className="ml-auto flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1">
                    <Filter className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">Filtro</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <h4 className="font-medium leading-none">Filtros</h4>
                      <p className="text-sm text-muted-foreground">
                        Ajusta los filtros para encontrar pedidos.
                      </p>
                    </div>
                    <div className="grid gap-4">
                       <div className="grid gap-2">
                          <Label htmlFor="search">Buscar por Código</Label>
                          <Input id="search" placeholder="0000-0000..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                       </div>
                       <div className="grid gap-2">
                        <Label htmlFor="date">Fecha del Pedido</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              id="date"
                              variant={"outline"}
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !dateFilter && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {dateFilter ? format(dateFilter, "PPP", { locale: es }) : <span>Elige una fecha</span>}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                              mode="single"
                              selected={dateFilter}
                              onSelect={setDateFilter}
                              initialFocus
                              locale={es}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      {user?.role === 'admin' && (
                        <div className="grid gap-2">
                          <Label htmlFor="location">Ubicación</Label>
                          <Select value={locationFilter} onValueChange={setLocationFilter}>
                            <SelectTrigger id="location" className="h-8">
                              <SelectValue placeholder="Seleccionar ubicación" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">Todas las ubicaciones</SelectItem>
                              {locations.map((loc) => (
                                <SelectItem key={loc.id} value={loc.id}>{loc.name_es}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                     <Button variant="ghost" onClick={clearFilters} className="w-full mt-2">Limpiar Filtros</Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
        </div>

        <TabsContent value={activeTab}>
          <Card>
            <CardHeader>
              <CardTitle>Pedidos</CardTitle>
              <CardDescription>
                Una lista de los pedidos recientes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    {user?.role === 'admin' && <TableHead>Ubicación</TableHead>}
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.length > 0 ? filteredOrders.map(order => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <div className="font-medium">{order.profiles?.name || 'N/A'}</div>
                        <div className="hidden text-sm text-muted-foreground md:inline">{order.id}</div>
                        {order.notes && (
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5 mt-1 max-w-xs break-words font-normal">
                            <strong>Nota:</strong> {order.notes}
                          </div>
                        )}
                      </TableCell>
                      {user?.role === 'admin' && <TableCell>{order.locations?.name_es || 'N/A'}</TableCell>}
                      <TableCell>
                        <Badge className={`${getStatusColor(order.status as OrderStatus)} text-white`}>{orderStatusToSpanish[order.status as OrderStatus] || order.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">S/ {Number(order.total_price ?? 0).toFixed(2)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-haspopup="true"
                              size="icon"
                              variant="ghost"
                              disabled={updatingOrderId === order.id}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                            {order.status === 'pending' ? (
                              ['Completado', 'Cancelado'].map(status => (
                                <DropdownMenuItem
                                  key={status}
                                  disabled={updatingOrderId === order.id}
                                  onSelect={() => handleStatusChange(order, status)}
                                >
                                  Marcar como {status}
                                </DropdownMenuItem>
                              ))
                            ) : (
                              <DropdownMenuItem disabled>
                                Pedido finalizado
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )) : (
                     <TableRow>
                        <TableCell colSpan={user?.role === 'admin' ? 5 : 4} className="h-24 text-center">
                            No se encontraron pedidos.
                        </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
