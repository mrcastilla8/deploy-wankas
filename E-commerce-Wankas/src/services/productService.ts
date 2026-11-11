import { supabase } from '@/lib/supabaseClient';
import { fetchProducts, ProductCatalogUnavailableError } from '@/services/productCatalog';
export { ProductCatalogError, ProductCatalogUnavailableError } from '@/services/productCatalog';

export async function getProducts() {
  if (!supabase) throw new ProductCatalogUnavailableError('El servicio de catálogo no está configurado.');
  return fetchProducts(supabase);
}
