'use client';

import { ProductCard } from '@/components/product-card';
import type { Product } from '@/types';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PackageSearch } from 'lucide-react';
import { useLocale } from '@/context/locale-context';
import { Loader } from '@/components/ui/loader';
import { Button } from '@/components/ui/button';

export default function ProductsPage() {
  const { translations } = useLocale();
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');

  const reloadProducts = useCallback(() => setRequestVersion(version => version + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        const response = await fetch('/api/products', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Catalog request failed');
        const productsData: unknown = await response.json();
        if (!Array.isArray(productsData)) throw new Error('Invalid catalog response');
        if (active) setAllProducts(productsData as Product[]);
      } catch {
        if (active && !controller.signal.aborted) setLoadError(true);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [requestVersion]);

  const categories = useMemo(() => {
    if (isLoading) return ['all'];
    const uniqueCategories = ['all', ...new Set(allProducts.map(p => p.category))];
    return uniqueCategories;
  }, [allProducts, isLoading]);

  const filteredAndSortedProducts = useMemo(() => {
    if (isLoading) return [];
    let filtered = [...allProducts];

    if (searchTerm) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.description && product.description.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(product => product.category === selectedCategory);
    }

    switch (sortBy) {
      case 'name-asc':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        filtered.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price-asc':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price-desc':
        filtered.sort((a, b) => b.price - a.price);
        break;
    }
    return filtered;
  }, [searchTerm, selectedCategory, sortBy, allProducts, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-15rem)]">
        <Loader text={translations.common.loading} size={48} />
      </div>
    );
  }

  if (loadError) {
    return <section className="space-y-4 text-center py-16" role="alert">
      <h1 className="font-headline text-3xl font-bold text-primary">{translations.productPage.title}</h1>
      <p className="text-muted-foreground">{translations.productPage.catalogError}</p>
      <Button onClick={reloadProducts}>{translations.productPage.retryCatalog}</Button>
    </section>;
  }

  return (
    <div className="space-y-8">
      <header className="text-center space-y-2">
        <h1 className="font-headline text-4xl font-bold text-primary">{translations.productPage.title}</h1>
        <p className="text-lg text-muted-foreground">{translations.productPage.tagline}</p>
      </header>

      <div className="sticky top-16 bg-background/90 backdrop-blur-sm z-10 py-4 rounded-md shadow">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center p-4 border rounded-lg bg-card">
          <Input
            type="text"
            placeholder={translations.productPage.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="md:col-span-1"
            aria-label={translations.productPage.searchPlaceholder}
          />
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full md:col-span-1" aria-label={translations.productPage.filterByCategory}>
              <SelectValue placeholder={translations.productPage.filterByCategory} />
            </SelectTrigger>
            <SelectContent>
              {categories.map(category => (
                <SelectItem key={category} value={category}>
                  {category === 'all' ? translations.productPage.allCategories : category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full md:col-span-1" aria-label={translations.productPage.sortBy}>
              <SelectValue placeholder={translations.productPage.sortBy} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">{translations.productPage.sortNameAsc}</SelectItem>
              <SelectItem value="name-desc">{translations.productPage.sortNameDesc}</SelectItem>
              <SelectItem value="price-asc">{translations.productPage.sortPriceAsc}</SelectItem>
              <SelectItem value="price-desc">{translations.productPage.sortPriceDesc}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {filteredAndSortedProducts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredAndSortedProducts.map((product: Product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <PackageSearch className="mx-auto h-24 w-24 text-muted-foreground mb-4" />
          <h2 className="font-headline text-2xl font-semibold text-foreground mb-2">{allProducts.length === 0 ? translations.productPage.emptyCatalog : translations.productPage.noProductsFound}</h2>
          <p className="text-muted-foreground">
            {translations.productPage.noProductsHint}
          </p>
        </div>
      )}
    </div>
  );
}
