import { getProducts } from '@/services/productService';
import { createCatalogResponse } from '@/services/productCatalog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return createCatalogResponse(getProducts);
}
