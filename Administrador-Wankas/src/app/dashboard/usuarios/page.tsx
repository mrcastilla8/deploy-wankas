
"use client"

import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import { adminFetch } from "@/lib/adminFetch"
import { Loader } from "@/components/ui/loader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlusCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const usersPath = "/api/admin/usuarios"

type ListedUser = {
  id: string
  name: string | null
  email: string | null
  role: string
  location_id: string | null
}

const emptyForm = { name: "", email: "", password: "", role: "worker", locationId: "" }

const errorMessages: Record<string, string> = {
  INVALID_INPUT: "Revisa los campos ingresados y el formato del identificador de sede.",
  LOCATION_NOT_FOUND: "La sede indicada no existe o ya no está disponible.",
  LOCATION_REQUIRES_WORKER: "Solo se puede asignar una sede a un trabajador.",
  USER_NOT_FOUND: "El usuario indicado no existe.",
  USER_CONFLICT: "El correo ya está en uso o existe un conflicto con el usuario.",
  USER_EMAIL_CONFLICT: "El correo está en proceso de cambio o requiere reconciliación. Si el conflicto persiste, solicita una revisión a soporte.",
  USER_CREATION_ROLLBACK_FAILED: "No se pudo completar el alta ni retirar la cuenta creada. Revisa el estado del usuario.",
  USER_UPDATE_ROLLBACK_FAILED: "No se pudo confirmar el cambio de correo. Solicita una revisión a soporte.",
  USER_PROFILE_UPDATE_FAILED_AFTER_EMAIL_CHANGE: "El correo se actualizó. Hubo un error al guardar los demás cambios. Recarga la lista antes de volver a editar.",
}

async function responseError(response: Response, fallback: string) {
  if (response.status === 401) return "Tu sesión no está disponible o ha caducado. Inicia sesión nuevamente."
  if (response.status === 403) return "Solo los administradores pueden gestionar usuarios."

  const body = await response.json().catch(() => null)
  return typeof body?.error === "string" && Object.hasOwn(errorMessages, body.error)
    ? errorMessages[body.error]
    : fallback
}

export default function UsuariosPage() {
  const { user } = useAuth()
  return <UserManagement key={user?.id} />
}

function UserManagement() {
  const { toast } = useToast()
  const [profiles, setProfiles] = React.useState<ListedUser[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)

  const [userToEdit, setUserToEdit] = React.useState<ListedUser | null>(null)

  const [formData, setFormData] = React.useState(emptyForm)

  const fetchUsers = React.useCallback(async (signal?: AbortSignal) => {
    const fallback = "No se pudieron cargar los usuarios."
    setLoading(true)
    setLoadError(null)
    try {
      const response = await adminFetch(usersPath, { signal, cache: "no-store" })
      if (!response.ok) {
        const message = await responseError(response, fallback)
        if (!signal?.aborted) setLoadError(message)
        return
      }
      const data: ListedUser[] = await response.json()
      if (!signal?.aborted) setProfiles(data)
    } catch {
      if (!signal?.aborted) setLoadError(fallback)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetchUsers(controller.signal)
    return () => controller.abort()
  }, [fetchUsers])

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };
  
  const handleRoleChange = (value: string) => {
    setFormData(prev => ({ ...prev, role: value, locationId: value === "worker" ? prev.locationId : "" }));
  }

  const handleOpenAddDialog = () => {
    setFormData(emptyForm)
    setIsAddDialogOpen(true)
  }

  const handleOpenEditDialog = (profile: ListedUser) => {
    setUserToEdit(profile)
    setFormData({
      name: profile.name || "",
      email: profile.email || "",
      password: "",
      role: profile.role,
      locationId: profile.location_id ?? "",
    })
    setIsEditDialogOpen(true)
  }

  const mutateUser = async (
    method: "POST" | "PATCH",
    body: Record<string, string | null>,
    successMessage: string,
    fallback: string,
    closeDialog: () => void,
  ) => {
    if (saving) return
    setSaving(true)
    try {
      const response = await adminFetch(usersPath, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const message = await responseError(response, fallback)
        if (response.status === 401 || response.status === 403) {
          setProfiles([])
          setLoadError(message)
        }
        toast({ variant: "destructive", title: "Error", description: message })
        return
      }
      closeDialog()
      toast({ title: "Éxito", description: successMessage })
      await fetchUsers()
    } catch {
      toast({ variant: "destructive", title: "Error", description: fallback })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault()
    const { name, email, password, role, locationId } = formData
    const body = { name, email, password, role, ...(locationId.trim() && { location_id: locationId.trim() }) }
    await mutateUser("POST", body, "Usuario creado correctamente.", "No se pudo crear el usuario.", () => {
      setIsAddDialogOpen(false)
      setFormData(emptyForm)
    })
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userToEdit) return

    const { name, email, role, locationId } = formData
    const body: Record<string, string | null> = { id: userToEdit.id }
    if (name.trim() !== (userToEdit.name ?? "")) body.name = name.trim()
    if (email.trim() !== (userToEdit.email ?? "")) body.email = email.trim()
    if (role !== userToEdit.role) body.role = role
    if (locationId.trim() !== (userToEdit.location_id ?? "")) body.location_id = locationId.trim() || null

    const close = () => {
      setIsEditDialogOpen(false)
      setUserToEdit(null)
    }
    if (Object.keys(body).length === 1) return close()
    await mutateUser("PATCH", body, "Usuario actualizado correctamente.", "No se pudo actualizar el usuario.", close)
  }

  if (loadError) {
    return <p role="alert" className="text-destructive">{loadError}</p>
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text="Cargando usuarios..." size={48} />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-headline">Gestión de Usuarios</h1>
        <p className="text-muted-foreground">
          Crea y administra los perfiles de los trabajadores y administradores.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
                <CardTitle>Usuarios</CardTitle>
                <CardDescription>
                    La baja de cuentas está temporalmente deshabilitada.
                </CardDescription>
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Button size="sm" className="h-7 gap-1" onClick={handleOpenAddDialog}>
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                        Añadir Usuario
                    </span>
                </Button>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map(profile => (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">{profile.name}</TableCell>
                  <TableCell>{profile.email}</TableCell>
                  <TableCell className="capitalize">{profile.role}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => handleOpenEditDialog(profile)}>Editar</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
      {/* Add User Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <form onSubmit={handleSaveUser}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Añadir Nuevo Usuario</DialogTitle>
                    <DialogDescription>
                        Rellena los detalles del nuevo usuario.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input id="name" required value={formData.name} onChange={handleFormChange} placeholder="John Doe" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" required value={formData.email} onChange={handleFormChange} placeholder="worker@wanka.com" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">Contraseña</Label>
                        <Input id="password" type="password" required minLength={6} autoComplete="new-password" value={formData.password} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="role">Rol</Label>
                        <Select value={formData.role} onValueChange={handleRoleChange}>
                            <SelectTrigger id="role">
                                <SelectValue placeholder="Seleccionar rol" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="worker">Trabajador</SelectItem>
                                <SelectItem value="admin">Administrador</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {formData.role === "worker" && (
                      <div className="grid gap-2">
                          <Label htmlFor="locationId">ID de sede (opcional)</Label>
                          <Input id="locationId" value={formData.locationId} onChange={handleFormChange} />
                      </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Guardar Usuario</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>
      
      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
            <form onSubmit={handleUpdateUser}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Editar Usuario</DialogTitle>
                    <DialogDescription>
                        Actualiza los detalles del usuario. La contraseña no se puede editar aquí.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                     <div className="grid gap-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input id="name" value={formData.name} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={formData.email} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="role">Rol</Label>
                        <Select value={formData.role} onValueChange={handleRoleChange}>
                            <SelectTrigger id="role">
                                <SelectValue placeholder="Seleccionar rol" />
                            </SelectTrigger>
                            <SelectContent>
                                {userToEdit?.role && userToEdit.role !== "worker" && userToEdit.role !== "admin" && (
                                  <SelectItem value={userToEdit.role} disabled>{userToEdit.role}</SelectItem>
                                )}
                                <SelectItem value="worker">Trabajador</SelectItem>
                                <SelectItem value="admin">Administrador</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {formData.role === "worker" && (
                      <div className="grid gap-2">
                          <Label htmlFor="locationId">ID de sede (opcional)</Label>
                          <Input id="locationId" value={formData.locationId} onChange={handleFormChange} />
                      </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Actualizar Usuario</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}
