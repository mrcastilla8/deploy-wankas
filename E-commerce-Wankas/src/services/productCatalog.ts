import type { Product } from '@/types';

export class ProductCatalogError extends Error {
  constructor(message: string) { super(message); this.name = 'ProductCatalogError'; }
}
export class ProductCatalogUnavailableError extends ProductCatalogError {
  constructor(message: string) { super(message); this.name = 'ProductCatalogUnavailableError'; }
}

function imageUrl(item: { thumbnail_url?: string | null; image_urls?: string[] | null }): string {
  const source = item.thumbnail_url || item.image_urls?.[0];
  if (!source) return 'https://placehold.co/600x400.png';
  try {
    const parsed = new URL(source);
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    throw new ProductCatalogError('El catálogo contiene una URL de imagen inválida.');
  }
}

export function mapProductRows(data: any[]): Product[] {
  return data.map((item: any): Product => {
    const category = Array.isArray(item.categories) ? item.categories[0]?.name_es : item.categories?.name_es;
    if (!item.id || typeof item.name_es !== 'string' || typeof item.price !== 'number' || typeof item.stock !== 'number' || (category !== null && category !== undefined && typeof category !== 'string')) {
      throw new ProductCatalogError('El catálogo contiene un producto con campos obligatorios inválidos.');
    }
    return {
      id: item.id,
      name: item.name_es,
      description: item.description_es ?? '',
      price: item.price,
      imageUrl: imageUrl(item),
      category: category ?? 'Sin categoría',
      stock: item.stock,
    };
  });
}

type ProductDatabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: any[] | null; error: unknown | null }>;
    };
  };
};

export async function fetchProducts(client: ProductDatabaseClient): Promise<Product[]> {
  try {
    const { data, error } = await client.from('products')
      .select('id, name_es, description_es, price, stock, image_urls, thumbnail_url, categories(name_es)')
      .order('name_es', { ascending: true });
    if (error) throw new ProductCatalogUnavailableError('No se pudo consultar el catálogo.');
    if (!data) throw new ProductCatalogUnavailableError('La consulta del catálogo no devolvió datos válidos.');
    return mapProductRows(data);
  } catch (error) {
    if (error instanceof ProductCatalogError) throw error;
    throw new ProductCatalogUnavailableError('No se pudo consultar el catálogo.');
  }
}

export async function createCatalogResponse(loadProducts: () => Promise<unknown>): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'application/json' };
  try {
    return new Response(JSON.stringify(await loadProducts()), { status: 200, headers });
  } catch (error) {
    const unavailable = error instanceof ProductCatalogUnavailableError;
    console.error(unavailable ? 'Catálogo no disponible.' : 'Error interno al consultar el catálogo.');
    return new Response(JSON.stringify({ error: unavailable ? 'El catálogo no está disponible temporalmente.' : 'Ocurrió un error interno.' }), {
      status: unavailable ? 503 : 500,
      headers,
    });
  }
}
