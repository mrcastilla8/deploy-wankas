export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      categories: {
        Row: {
          id: string
          name_es: string
          name_en: string
          description_es: string | null
          description_en: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name_es: string
          name_en: string
          description_es?: string | null
          description_en?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name_es?: string
          name_en?: string
          description_es?: string | null
          description_en?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      locations: {
        Row: {
          id: string
          name_es: string
          name_en: string | null
          address: string
          opening_hours_es: Json | null
          opening_hours_en: Json | null
          latitude: number | null
          longitude: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name_es: string
          name_en?: string | null
          address: string
          opening_hours_es?: Json | null
          opening_hours_en?: Json | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name_es?: string
          name_en?: string | null
          address?: string
          opening_hours_es?: Json | null
          opening_hours_en?: Json | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      order_items: {
        Row: {
          order_id: string
          product_id: string
          quantity: number
          price_at_purchase: number
        }
        Insert: {
          order_id: string
          product_id: string
          quantity: number
          price_at_purchase: number
        }
        Update: {
          order_id?: string
          product_id?: string
          quantity?: number
          price_at_purchase?: number
        }
      }
      orders: {
        Row: {
          id: string
          user_id: string
          location_id: string
          order_date: string
          pickup_date: string
          status: string
          total_price: number
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          location_id: string
          order_date?: string
          pickup_date: string
          status?: string
          total_price: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          location_id?: string
          order_date?: string
          pickup_date?: string
          status?: string
          total_price?: number
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      products: {
        Row: {
          id: string
          category_id: string
          name_es: string
          name_en: string | null
          description_es: string | null
          description_en: string | null
          price: number
          stock: number
          image_urls: string[] | null
          thumbnail_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          category_id: string
          name_es: string
          name_en?: string | null
          description_es?: string | null
          description_en?: string | null
          price: number
          stock?: number
          image_urls?: string[] | null
          thumbnail_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          category_id?: string
          name_es?: string
          name_en?: string | null
          description_es?: string | null
          description_en?: string | null
          price?: number
          stock?: number
          image_urls?: string[] | null
          thumbnail_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          name: string | null
          email: string | null
          phone_number: string | null
          created_at: string
          updated_at: string
          role: 'customer' | 'worker' | 'admin'
          location_id: string | null
          password_hash: string | null
        }
        Insert: {
          id: string
          name?: string | null
          email?: string | null
          phone_number?: string | null
          created_at?: string
          updated_at?: string
          role?: 'customer' | 'worker' | 'admin'
          location_id?: string | null
          password_hash?: string | null
        }
        Update: {
          id?: string
          name?: string | null
          email?: string | null
          phone_number?: string | null
          created_at?: string
          updated_at?: string
          role?: 'customer' | 'worker' | 'admin'
          location_id?: string | null
          password_hash?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
