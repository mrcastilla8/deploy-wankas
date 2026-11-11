'use client';

import type { CartItem, Product } from '@/types';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useToast } from "@/hooks/use-toast";
import { useLocale } from './locale-context';


interface CartContextType {
  cartItems: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getCartTotal: () => number;
  getItemCount: () => number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const PLACEHOLDER_IMAGE = 'https://placehold.co/600x400.png';

/**
 * Devuelve una cantidad entera válida o null.
 * El stock es solo una cota local: PostgreSQL sigue siendo la autoridad final.
 */
function sanitizeQuantity(value: number, maxStock?: number): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  if (typeof maxStock === 'number' && Number.isFinite(maxStock)) {
    const max = Math.max(0, Math.trunc(maxStock));
    if (max <= 0) return null;
    return Math.min(value, max);
  }

  return value;
}

/**
 * Sanea el carrito persistido en localStorage para descartar cantidades
 * negativas, cero, fraccionarias, productos repetidos o stock inválido.
 */
function sanitizeStoredCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];

  const result: CartItem[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;

    const item = raw as Partial<CartItem>;
    if (typeof item.id !== 'string' || item.id.trim() === '' || seen.has(item.id)) {
      continue;
    }

    const price = Number(item.price);
    if (!Number.isFinite(price) || price < 0) continue;

    const rawStock = Number(item.stock);
    const stock = Number.isFinite(rawStock) ? Math.max(0, Math.trunc(rawStock)) : 0;
    const quantity = sanitizeQuantity(Number(item.quantity), stock);

    if (quantity === null) continue;

    seen.add(item.id);
    result.push({
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Producto',
      description: typeof item.description === 'string' ? item.description : '',
      price,
      imageUrl: typeof item.imageUrl === 'string' && item.imageUrl ? item.imageUrl : PLACEHOLDER_IMAGE,
      category: typeof item.category === 'string' && item.category ? item.category : 'Sin categoría',
      stock,
      quantity,
    });
  }

  return result;
}

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartLoaded, setIsCartLoaded] = useState(false);
  const { toast } = useToast();
  const { translations } = useLocale();


  useEffect(() => {
    try {
      const storedCart = localStorage.getItem('wankas-cart');
      if (storedCart) {
        setCartItems(sanitizeStoredCart(JSON.parse(storedCart)));
      }
    } catch (error) {
      console.error("Failed to load cart from localStorage", error);
      localStorage.removeItem('wankas-cart');
    } finally {
      setIsCartLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isCartLoaded) {
      localStorage.setItem('wankas-cart', JSON.stringify(cartItems));
    }
  }, [cartItems, isCartLoaded]);

  const addToCart = (product: Product, quantity: number = 1) => {
    const stock = Number.isFinite(product.stock) ? Math.max(0, Math.trunc(product.stock)) : 0;

    if (stock <= 0) {
      toast({
        title: translations.common.error,
        description: `"${product.name}" no tiene stock disponible.`,
        variant: 'destructive',
      });
      return;
    }

    const requested = sanitizeQuantity(quantity, stock);
    if (requested === null) {
      toast({
        title: translations.common.error,
        description: 'La cantidad debe ser un número entero mayor que cero.',
        variant: 'destructive',
      });
      return;
    }

    const existingItem = cartItems.find(item => item.id === product.id);

    if (existingItem) {
      const nextQuantity = Math.min(existingItem.quantity + requested, stock);

      if (nextQuantity === existingItem.quantity) {
        toast({
          title: translations.common.error,
          description: `No hay más stock disponible de "${product.name}".`,
          variant: 'destructive',
        });
        return;
      }

      setCartItems(prevItems =>
        prevItems.map(item =>
          item.id === product.id ? { ...item, stock, quantity: nextQuantity } : item
        )
      );
    } else {
      setCartItems(prevItems => [...prevItems, { ...product, stock, quantity: requested }]);
    }

    toast({ 
      title: translations.myPantryPage.addedToCartTitle, 
      description: translations.myPantryPage.addedToCartDesc.replace('{productName}', product.name) 
    });
  };

  const removeFromCart = (productId: string) => {
    const removedItem = cartItems.find(item => item.id === productId);
    setCartItems(prevItems => prevItems.filter(item => item.id !== productId));
    if (removedItem) {
      toast({ 
        title: translations.myPantryPage.removedFromCartTitle, 
        description: translations.myPantryPage.removedFromCartDesc
      });
    }
  };

  const updateQuantity = (productId: string, quantity: number) => {
    const item = cartItems.find(cartItem => cartItem.id === productId);

    if (!item) {
      return;
    }

    if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) {
      toast({
        title: translations.common.error,
        description: 'La cantidad debe ser un número entero.',
        variant: 'destructive',
      });
      return;
    }

    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    const stock = Number.isFinite(item.stock) ? Math.max(0, Math.trunc(item.stock)) : quantity;

    if (stock <= 0) {
      removeFromCart(productId);
      return;
    }

    if (quantity > stock) {
      toast({
        title: translations.common.error,
        description: `Solo hay ${stock} unidades disponibles de "${item.name}".`,
        variant: 'destructive',
      });
    }

    const nextQuantity = Math.min(quantity, stock);
    setCartItems(prevItems =>
      prevItems.map(cartItem =>
        cartItem.id === productId ? { ...cartItem, quantity: nextQuantity } : cartItem
      )
    );
  };

  const clearCart = () => {
    setCartItems([]);
    toast({ 
      title: translations.myPantryPage.cartClearedTitle, 
      description: translations.myPantryPage.cartClearedDesc
    });
  };

  const getCartTotal = () => {
    return cartItems.reduce((total, item) => total + item.price * item.quantity, 0);
  };

  const getItemCount = () => {
    return cartItems.reduce((count, item) => count + item.quantity, 0);
  };

  return (
    <CartContext.Provider value={{ cartItems, addToCart, removeFromCart, updateQuantity, clearCart, getCartTotal, getItemCount }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = (): CartContextType => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
