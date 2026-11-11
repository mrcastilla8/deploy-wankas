
"use client"

import * as React from "react"
import { useAuth } from "@/hooks/use-auth"
import type { Product, Category } from "@/types"
import { adminCache } from "@/lib/adminCache"
import { adminMutation, adminRequest, describeAdminError } from "@/lib/adminApi"
import { parseNewProduct, parseProductChanges, type ProductFormValues } from "@/lib/catalogoForm"
import { Loader } from "@/components/ui/loader"
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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MoreHorizontal, PlusCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Proyección que devuelve GET /api/admin/catalogo (REC-03).
type CatalogProduct = Pick<Product, 'id' | 'name_es' | 'description_es' | 'price' | 'stock' | 'category_id'> & {
  categories: Pick<Category, 'name_es'> | null
}
type CatalogCategory = Pick<Category, 'id' | 'name_es'>
type CatalogPayload = { products: CatalogProduct[]; categories: CatalogCategory[] }

const CATALOG_API = '/api/admin/catalogo'
const EMPTY_FORM: ProductFormValues = { name_es: "", description_es: "", price: "", stock: "", category_id: "" }

export default function CatalogoPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [products, setProducts] = React.useState<CatalogProduct[]>([])
  const [categories, setCategories] = React.useState<CatalogCategory[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)

  const [productToEdit, setProductToEdit] = React.useState<CatalogProduct | null>(null)
  const [productToDeleteId, setProductToDeleteId] = React.useState<string | null>(null)

  const [formData, setFormData] = React.useState<ProductFormValues>(EMPTY_FORM)

  const fetchProductsAndCategories = React.useCallback(async (forceRefresh = false) => {
    // Verificar caché en memoria primero (instantáneo, 0ms)
    if (!forceRefresh) {
      const cached = adminCache.get<CatalogPayload>('catalogo')
      if (cached) {
        setProducts(cached.products)
        setCategories(cached.categories)
        setLoadError(null)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    try {
      const data = await adminRequest<CatalogPayload>(CATALOG_API)
      adminCache.set('catalogo', data)
      setProducts(data.products)
      setCategories(data.categories)
      setLoadError(null)
    } catch (error) {
      // No se muestran datos anteriores ni una lista vacía como si fuera real.
      adminCache.invalidate('catalogo')
      setProducts([])
      setCategories([])
      setLoadError(describeAdminError(error))
    } finally {
      setLoading(false)
    }
  }, [])

  const reloadAfterMutation = React.useCallback(() => {
    adminCache.invalidate('catalogo')
    return fetchProductsAndCategories(true)
  }, [fetchProductsAndCategories])

  const showError = React.useCallback((error: unknown) => {
    toast({ variant: "destructive", title: "Error", description: describeAdminError(error) })
  }, [toast])

  React.useEffect(() => {
    fetchProductsAndCategories()
  }, [fetchProductsAndCategories])
  
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (value: string) => {
    setFormData(prev => ({...prev, category_id: value}));
  };

  const handleOpenAddDialog = () => {
    setFormData(EMPTY_FORM)
    setIsAddDialogOpen(true)
  }

  const handleOpenEditDialog = (product: CatalogProduct) => {
    setProductToEdit(product)
    setFormData({
      name_es: product.name_es,
      description_es: product.description_es || "",
      price: String(product.price),
      stock: String(product.stock),
      category_id: product.category_id,
    })
    setIsEditDialogOpen(true)
  }

  const handleOpenDeleteDialog = (productId: string) => {
    setProductToDeleteId(productId)
    setIsDeleteDialogOpen(true)
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseNewProduct(formData)
    if (!parsed.ok) {
      toast({ variant: "destructive", title: "Error", description: parsed.message })
      return
    }

    setSaving(true)
    try {
      await adminMutation(CATALOG_API, 'POST', parsed.value)
      toast({ title: "Éxito", description: "Producto añadido correctamente."})
      setIsAddDialogOpen(false)
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productToEdit) return

    const parsed = parseProductChanges(formData)
    if (!parsed.ok) {
      toast({ variant: "destructive", title: "Error", description: parsed.message })
      return
    }

    setSaving(true)
    try {
      // La API no permite modificar el stock por PATCH; solo se envían los datos del producto.
      await adminMutation(CATALOG_API, 'PATCH', { id: productToEdit.id, ...parsed.value })
      toast({ title: "Éxito", description: "Producto actualizado correctamente."})
      setIsEditDialogOpen(false)
      setProductToEdit(null)
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteProduct = async () => {
    if (!productToDeleteId) return

    setSaving(true)
    try {
      await adminMutation(CATALOG_API, 'DELETE', { id: productToDeleteId })
      toast({ title: "Éxito", description: "Producto eliminado correctamente."})
      await reloadAfterMutation()
    } catch (error) {
      showError(error)
    } finally {
      setSaving(false)
      setIsDeleteDialogOpen(false)
      setProductToDeleteId(null)
    }
  }


  if (user?.role !== 'admin') {
    return <p>Acceso denegado.</p>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text="Cargando catálogo..." size={48} />
      </div>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No se pudo cargar el catálogo</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => fetchProductsAndCategories(true)}>Reintentar</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-headline">Gestión de Catálogo</h1>
        <p className="text-muted-foreground">
          Añade, edita o elimina productos de la tienda.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center">
            <div className="grid gap-2">
                <CardTitle>Productos</CardTitle>
                <CardDescription>
                    Gestiona los productos de tu tienda.
                </CardDescription>
            </div>
            <div className="ml-auto flex items-center gap-2">
                <Button size="sm" className="h-7 gap-1" onClick={handleOpenAddDialog}>
                    <PlusCircle className="h-3.5 w-3.5" />
                    <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                        Añadir Producto
                    </span>
                </Button>
            </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map(product => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name_es}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{product.categories?.name_es || 'N/A'}</Badge>
                  </TableCell>
                   <TableCell>{product.stock}</TableCell>
                  <TableCell className="text-right">S/ {product.price.toFixed(2)}</TableCell>
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
                        <DropdownMenuItem onSelect={() => handleOpenEditDialog(product)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem className="text-red-600" onSelect={() => handleOpenDeleteDialog(product.id)}>Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Product Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleSaveProduct}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Añadir Nuevo Producto</DialogTitle>
                    <DialogDescription>
                        Rellena los detalles del nuevo producto.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name_es">Nombre</Label>
                        <Input id="name_es" value={formData.name_es} onChange={handleFormChange} placeholder="Lomo Saltado" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="description_es">Descripción</Label>
                        <Textarea id="description_es" value={formData.description_es} onChange={handleFormChange} placeholder="Delicioso plato peruano." />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="price">Precio</Label>
                        <Input id="price" type="number" value={formData.price} onChange={handleFormChange} placeholder="45.00" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="stock">Stock</Label>
                        <Input id="stock" type="number" value={formData.stock} onChange={handleFormChange} placeholder="100" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="category_id">Categoría</Label>
                        <Select value={formData.category_id} onValueChange={handleSelectChange}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar categoría" />
                            </SelectTrigger>
                            <SelectContent>
                                {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name_es}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Guardar Producto</Button>
                </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
            <form onSubmit={handleUpdateProduct}>
                <DialogHeader>
                    <DialogTitle className="font-headline">Editar Producto</DialogTitle>
                    <DialogDescription>
                        Actualiza los detalles del producto.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name_es">Nombre</Label>
                        <Input id="name_es" value={formData.name_es} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="description_es">Descripción</Label>
                        <Textarea id="description_es" value={formData.description_es} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="price">Precio</Label>
                        <Input id="price" type="number" value={formData.price} onChange={handleFormChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="stock">Stock</Label>
                        <Input id="stock" type="number" value={formData.stock} disabled readOnly aria-describedby="stock-help" />
                        <p id="stock-help" className="text-xs text-muted-foreground">
                          El stock no se puede modificar desde esta edición. Lo actualizan los pedidos.
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="category_id">Categoría</Label>
                        <Select value={formData.category_id} onValueChange={handleSelectChange}>
                            <SelectTrigger>
                                <SelectValue placeholder="Seleccionar categoría" />
                            </SelectTrigger>
                            <SelectContent>
                                {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name_es}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" disabled={saving}>Actualizar Producto</Button>
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
              Esta acción no se puede deshacer. Esto eliminará permanentemente el producto de la base de datos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProduct} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
