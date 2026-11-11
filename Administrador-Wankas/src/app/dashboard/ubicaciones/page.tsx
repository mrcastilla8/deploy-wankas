
"use client"

import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import type { Location } from "@/types"
import { adminCache } from "@/lib/adminCache"
import { adminMutation, adminRequest, describeAdminError } from "@/lib/adminApi"
import { Loader } from "@/components/ui/loader"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoreHorizontal, PlusCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Proyección que devuelve GET /api/admin/ubicaciones (REC-03).
type AdminLocation = Pick<Location, 'id' | 'name_es' | 'address'>

const LOCATIONS_API = '/api/admin/ubicaciones'

export default function UbicacionesPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [locations, setLocations] = React.useState<AdminLocation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)

  const [locationToEdit, setLocationToEdit] = React.useState<AdminLocation | null>(null)
  const [locationToDeleteId, setLocationToDeleteId] = React.useState<string | null>(null)

  const [formData, setFormData] = React.useState({
    name_es: "",
    address: ""
  })

  const fetchLocations = React.useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = adminCache.get<AdminLocation[]>('ubicaciones')
      if (cached) {
        setLocations(cached)
        setLoadError(null)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    try {
      const data = await adminRequest<AdminLocation[]>(LOCATIONS_API)
      adminCache.set('ubicaciones', data)
      setLocations(data)
      setLoadError(null)
    } catch (error) {
      // No se muestran datos anteriores ni una lista vacía como si fuera real.
      adminCache.invalidate('ubicaciones')
      setLocations([])
      setLoadError(describeAdminError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadAfterMutation = React.useCallback(() => {
    adminCache.invalidate('ubicaciones')
    return fetchLocations(true)
  }, [fetchLocations])

  const showError = React.useCallback((error: unknown) => {
    toast({ variant: "destructive", title: "Error", description: describeAdminError(error) })
  }, [toast])

  const readForm = () => ({ name_es: formData.name_es.trim(), address: formData.address.trim() })

  React.useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleOpenAddDialog = () => {
    setFormData({ name_es: "", address: "" })
    setIsAddDialogOpen(true)
  }

  const handleOpenEditDialog = (location: AdminLocation) => {
    setLocationToEdit(location)
    setFormData({
      name_es: location.name_es,
      address: location.address,
    })
    setIsEditDialogOpen(true)
  }

  const handleOpenDeleteDialog = (locationId: string) => {
    setLocationToDeleteId(locationId)
    setIsDeleteDialogOpen(true)
  }
  
  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = readForm()

    if (!body.name_es || !body.address) {
        toast({ variant: "destructive", title: "Error", description: "Por favor, rellena todos los campos."})
        return
    }

    setSaving(true)
    try {
      await adminMutation(LOCATIONS_API, 'POST', body)
      toast({ title: "Éxito", description: "Ubicación añadida correctamente."})
      setIsAddDialogOpen(false)
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locationToEdit) return

    const body = readForm()
    if (!body.name_es || !body.address) {
        toast({ variant: "destructive", title: "Error", description: "Por favor, rellena todos los campos."})
        return
    }

    setSaving(true)
    try {
      await adminMutation(LOCATIONS_API, 'PATCH', { id: locationToEdit.id, ...body })
      toast({ title: "Éxito", description: "Ubicación actualizada correctamente."})
      setIsEditDialogOpen(false)
      setLocationToEdit(null)
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLocation = async () => {
    if (!locationToDeleteId) return

    setSaving(true)
    try {
      await adminMutation(LOCATIONS_API, 'DELETE', { id: locationToDeleteId })
      toast({ title: "Éxito", description: "Ubicación eliminada correctamente."})
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
      setIsDeleteDialogOpen(false)
      setLocationToDeleteId(null)
    }
  }

  if (user?.role !== 'admin') {
    return <p>Acceso denegado.</p>
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text="Cargando ubicaciones..." size={48} />
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No se pudieron cargar las ubicaciones</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => fetchLocations(true)}>Reintentar</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-headline">Gestión de Ubicaciones</h1>
        <p className="text-muted-foreground">
          Crea y administra las sucursales de tu tienda.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
                <CardTitle>Ubicaciones</CardTitle>
                <CardDescription>
                    Gestiona las sucursales de tu tienda.
                </CardDescription>
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Button size="sm" className="h-7 gap-1" onClick={handleOpenAddDialog}>
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                        Añadir Ubicación
                    </span>
                </Button>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map(location => (
                <TableRow key={location.id}>
                  <TableCell className="font-medium">{location.name_es}</TableCell>
                  <TableCell>{location.address}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button aria-haspopup="true" size="icon" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Toggle menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => handleOpenEditDialog(location)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onSelect={() => handleOpenDeleteDialog(location.id)}>Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {/* Add Location Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleSaveLocation}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Añadir Nueva Ubicación</DialogTitle>
                    <DialogDescription>
                        Rellena los detalles de la nueva sucursal.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name_es">Nombre</Label>
                        <Input id="name_es" value={formData.name_es} onChange={handleFormChange} placeholder="Wanka - Lince" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="address">Dirección</Label>
                        <Input id="address" value={formData.address} onChange={handleFormChange} placeholder="Av. Arequipa 2345, Lince" />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Guardar Ubicación</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>
      
      {/* Edit Location Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleUpdateLocation}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Editar Ubicación</DialogTitle>
                    <DialogDescription>
                        Actualiza los detalles de la sucursal.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name_es">Nombre</Label>
                        <Input id="name_es" value={formData.name_es} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="address">Dirección</Label>
                        <Input id="address" value={formData.address} onChange={handleFormChange} />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Actualizar Ubicación</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
       <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Estás completamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Esto eliminará permanentemente la ubicación de la base de datos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLocation} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
