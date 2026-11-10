import type { Database } from "./database.types";

export type Location = Database['public']['Tables']['locations']['Row'];
export type Category = Database['public']['Tables']['categories']['Row'];

export type Product = Database['public']['Tables']['products']['Row'] & {
    categories?: Category; 
};

export type OrderItem = Database['public']['Tables']['order_items']['Row'] & {
    products?: Product; 
};

export type Order = Database['public']['Tables']['orders']['Row'] & {
    profiles?: Database['public']['Tables']['profiles']['Row'];
    locations?: Location;
    order_items?: OrderItem[]; 
};

export type UserProfile = Omit<Database['public']['Tables']['profiles']['Row'], 'password_hash'> & {
    locationName?: string; 
};

export type OrderStatus = 'pending' | 'completed' | 'cancelled';

export type OrderStatusSpanishMap = {
    [key in OrderStatus]: 'Pendiente' | 'Completado' | 'Cancelado';
};

export const orderStatusToSpanish: OrderStatusSpanishMap = {
    pending: 'Pendiente',
    completed: 'Completado',
    cancelled: 'Cancelado',
};

export const spanishToOrderStatus = (spanishStatus: string): OrderStatus | undefined => {
    const entry = Object.entries(orderStatusToSpanish).find(([, value]) => value === spanishStatus);
    return entry ? entry[0] as OrderStatus : undefined;
}

export type ProductCategory = 'Plato Principal' | 'Bebida' | 'Postre' | 'Entrada';
