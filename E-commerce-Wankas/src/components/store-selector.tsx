'use client';

import type { StoreLocation, TimeSlot } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MapPin, Clock } from 'lucide-react';
import { useLocale } from '@/context/locale-context';
import { getStoreLocations, getAvailableTimeSlots } from '@/services/locationService';
import { Loader } from '@/components/ui/loader';
import { Alert, AlertDescription } from './ui/alert';

interface StoreSelectorProps {
  selectedStoreId: string | undefined;
  onStoreSelect: (storeId: string) => void;
  selectedTimeSlotId: string | undefined;
  onSelectionChange: (selection: { timeSlotId: string; pickupDate: Date } | null) => void;
}

export function StoreSelector({ 
  selectedStoreId, 
  onStoreSelect,
  selectedTimeSlotId,
  onSelectionChange
}: StoreSelectorProps) {
  const [storeLocations, setStoreLocations] = useState<StoreLocation[]>([]);
  const [allTimeSlots, setAllTimeSlots] = useState<Awaited<ReturnType<typeof getAvailableTimeSlots>>>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(true);
  const [isLoadingTimeSlots, setIsLoadingTimeSlots] = useState(true);
  const { translations } = useLocale();

  useEffect(() => {
    const fetchLocations = async () => {
      setIsLoadingLocations(true);
      try {
        const locations = await getStoreLocations();
        setStoreLocations(locations);
      } catch (error) {
        console.error("Error fetching store locations:", error);
      } finally {
        setIsLoadingLocations(false);
      }
    };

    const fetchTimeSlots = async () => {
      setIsLoadingTimeSlots(true);
      try {
        const timeSlots = await getAvailableTimeSlots();
        setAllTimeSlots(timeSlots);
      } catch (error) {
        console.error("Error fetching time slots:", error);
      } finally {
        setIsLoadingTimeSlots(false);
      }
    };

    fetchLocations();
    fetchTimeSlots();
  }, []);
  
  const displayConfig = useMemo<{ slots: (TimeSlot & { isDisabled?: boolean })[]; message: string; baseDate: Date }>(() => {
    if (isLoadingTimeSlots) {
      return { slots: [], message: '', baseDate: new Date() };
    }

    const now = new Date();
    const dayOfWeek = now.getDay();

    const parseStartTime = (timeRange: string, date: Date): Date => {
      const startTimeString = timeRange.split(' - ')[0];
      const slotTime = new Date(date);
      const [time, modifier] = startTimeString.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      slotTime.setHours(hours, minutes, 0, 0);
      return slotTime;
    };
    
    const todaysFutureSlots = allTimeSlots.filter(slot => slot.available && parseStartTime(slot.time, now) > now);
    
    let baseDate = new Date(now);
    let message = '';
    let slotsToDisplay: (TimeSlot & { isDisabled?: boolean })[] = [...allTimeSlots];

    if (todaysFutureSlots.length > 0) {
      slotsToDisplay = slotsToDisplay.map(slot => ({
        ...slot,
        isDisabled: !(slot.available && parseStartTime(slot.time, now) > now)
      }));
    } else {
      let daysToAdd = 1;
      if (dayOfWeek === 6) {
          daysToAdd = 2;
          message = translations.storeSelector.slotsForMonday;
      } else if (dayOfWeek === 0) {
          daysToAdd = 1;
          message = translations.storeSelector.slotsForMonday;
      } else {
          message = translations.storeSelector.slotsForTomorrow;
      }
      baseDate.setDate(now.getDate() + daysToAdd);
      
      slotsToDisplay = slotsToDisplay.map(slot => ({ ...slot, isDisabled: !slot.available }));
    }

    return { slots: slotsToDisplay, message, baseDate };
  }, [allTimeSlots, isLoadingTimeSlots, translations]);

  const handleTimeSlotChange = (timeSlotId: string) => {
    if (displayConfig.baseDate) {
      onSelectionChange({ timeSlotId, pickupDate: displayConfig.baseDate });
    } else {
      onSelectionChange(null);
    }
  };

  const selectedStoreDetails = storeLocations.find(s => s.id === selectedStoreId);

  return (
    <Card className="w-full shadow-md">
      <CardHeader>
        <CardTitle className="font-headline text-xl flex items-center">
          <MapPin className="mr-2 h-6 w-6 text-primary" />
          {translations.checkoutPage.storeSelectionTitle}
        </CardTitle>
        <CardDescription>{translations.checkoutPage.storeSelectionDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="store-select" className="text-md font-medium">{translations.checkoutPage.storeLabel}</Label>
          {isLoadingLocations ? (
            <div className="mt-1">
              <Loader text={translations.storeSelector.loadingStores} />
            </div>
          ) : storeLocations.length > 0 ? (
            <Select value={selectedStoreId} onValueChange={onStoreSelect}>
              <SelectTrigger id="store-select" className="w-full mt-1">
                <SelectValue placeholder={translations.checkoutPage.storePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {storeLocations.map(store => (
                  <SelectItem key={store.id} value={store.id}>
                    {store.name} - {store.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">No hay tiendas disponibles.</p>
          )}
          {selectedStoreDetails && (
            <p className="text-sm text-muted-foreground mt-2">
              {translations.storeSelector.operatingHoursLabel.replace('{hours}', selectedStoreDetails.operatingHours)}
            </p>
          )}
        </div>

        {selectedStoreId && (
          <div>
            <Label className="text-md font-medium flex items-center mb-2">
              <Clock className="mr-2 h-5 w-5 text-primary" />
              {translations.checkoutPage.pickupTimeLabel}
            </Label>
            {isLoadingTimeSlots ? (
                <Loader />
            ) : displayConfig.slots.length > 0 ? (
              <>
                {displayConfig.message && (
                  <Alert className="mb-4 bg-blue-50 border-blue-200">
                    <AlertDescription className="text-blue-700">
                      {displayConfig.message}
                    </AlertDescription>
                  </Alert>
                )}
                <RadioGroup
                  value={selectedTimeSlotId}
                  onValueChange={handleTimeSlotChange}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  {displayConfig.slots.map(slot => (
                    <Label
                      key={slot.id}
                      htmlFor={slot.id}
                      className={`flex items-center space-x-2 border rounded-md p-3 transition-all
                        ${selectedTimeSlotId === slot.id ? 'border-primary ring-2 ring-primary bg-primary/5' : 'hover:border-primary/50'}
                        ${slot.isDisabled ? 'opacity-50 cursor-not-allowed bg-muted/50' : 'cursor-pointer'}`}
                    >
                      <RadioGroupItem value={slot.id} id={slot.id} disabled={slot.isDisabled} />
                      <span>{slot.time}</span>
                    </Label>
                  ))}
                </RadioGroup>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{translations.storeSelector.noAvailableTimeSlots}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
