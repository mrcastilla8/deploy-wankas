import type { StoreLocation } from '@/types';
import { supabase } from '@/lib/supabaseClient';
import { timeSlots as hardcodedTimeSlots } from '@/data/stores';

export async function getStoreLocations(): Promise<StoreLocation[]> {
  await new Promise(resolve => setTimeout(resolve, 300));

  if (!supabase) {
    console.warn("Supabase client not available. Cannot fetch store locations.");
    return [];
  }

  const locationsTableName = 'locations';

  try {
    console.log(`Fetching store locations from Supabase table: ${locationsTableName}`);
    const { data, error } = await supabase
      .from(locationsTableName)
      .select(`
        id,
        name_es,
        address,
        opening_hours_es,
        latitude,
        longitude
      `)
      .order('name_es', { ascending: true });

    if (error) {
      console.error("Error fetching store locations from Supabase:", error);
      return [];
    }

    if (!data) {
      console.warn("No store location data received from Supabase.");
      return [];
    }

    console.log("Store locations fetched from Supabase:", data.length);

    const locations: StoreLocation[] = data.map((item) => {
      const operatingHours = typeof item.opening_hours_es === 'string' 
        ? item.opening_hours_es 
        : JSON.stringify(item.opening_hours_es);

      return {
        id: item.id,
        name: item.name_es || 'Tienda sin nombre',
        address: item.address || 'Dirección no disponible',
        operatingHours: operatingHours || 'Horario no disponible',
        latitude: item.latitude,
        longitude: item.longitude,
      };
    });
    return locations;

  } catch (e) {
    console.error("Exception fetching store locations:", e);
    return [];
  }
}

export async function getAvailableTimeSlots(): Promise<typeof hardcodedTimeSlots> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return hardcodedTimeSlots;
}
