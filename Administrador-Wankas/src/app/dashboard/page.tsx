
"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { adminRequest, describeAdminError } from "@/lib/adminApi"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader } from "@/components/ui/loader"
import type { Order, OrderStatus } from "@/types"
import { orderStatusToSpanish } from "@/types"
import { ShoppingCart, Package, MapPin, DollarSign } from "lucide-react"

// Proyección que devuelve GET /api/admin/dashboard (REC-03), solo para admin.
type DashboardPayload = {
  stats: { totalOrders: number; totalRevenue: number; activeProducts: number; activeLocations: number }
  recentOrders: Array<Pick<Order, 'id' | 'total_price' | 'status'> & {
    profiles: { name: string | null } | null
    locations: { name_es: string } | null
  }>
}

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [data, setData] = React.useState<DashboardPayload | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const isAdmin = user?.role === 'admin'

  const fetchDashboardData = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await adminRequest<DashboardPayload>('/api/admin/dashboard'))
      setLoadError(null)
    } catch (error) {
      setData(null)
      setLoadError(describeAdminError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    // No hacer nada hasta que el usuario esté autenticado
    if (!user) return
    // El resumen es solo para administradores; el trabajador trabaja desde sus pedidos.
    if (!isAdmin) {
      router.replace('/dashboard/pedidos')
      return
    }
    fetchDashboardData()
  }, [user, isAdmin, router, fetchDashboardData])

  if (!isAdmin || loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text="Cargando panel..." size={48} />
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No se pudo cargar el resumen</CardTitle>
          <CardDescription>{loadError ?? 'No se recibieron datos del servidor.'}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={fetchDashboardData}>Reintentar</Button>
        </CardContent>
      </Card>
    )
  }

  const { stats, recentOrders } = data
  const statCards = [
    {
      title: "Total Pedidos",
      value: stats.totalOrders,
      icon: ShoppingCart,
      description: "Todos los pedidos registrados",
    },
    {
      title: "Ingresos Totales",
      value: `S/ ${stats.totalRevenue.toFixed(2)}`,
      icon: DollarSign,
      description: "Suma de pedidos completados",
    },
    {
      title: "Productos Activos",
      value: stats.activeProducts,
      icon: Package,
      description: "Productos en el catálogo",
    },
    {
      title: "Ubicaciones Activas",
      value: stats.activeLocations,
      icon: MapPin,
      description: "Sucursales operativas",
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-headline">Resumen del Panel</h1>
        <p className="text-muted-foreground">
          Bienvenido de nuevo, {user?.name}. Aquí tienes un resumen de la actividad.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

       <Card>
        <CardHeader>
          <CardTitle className="font-headline">Pedidos Recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-muted rounded-md">
                    <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">{order.profiles?.name || 'Cliente'}</p>
                    <p className="text-sm text-muted-foreground">{order.id} - {order.locations?.name_es}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">S/ {order.total_price.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">{orderStatusToSpanish[order.status as OrderStatus] || order.status}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

