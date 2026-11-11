'use client';

import { useAuth } from '@/context/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User as UserIcon, Mail, LogOut, Edit3, AlertTriangle, PackageCheck, History } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { useLocale } from '@/context/locale-context';
import { getUserOrders, cancelOrder as cancelOrderService, type EnrichedOrder } from '@/services/orderService';
import type { User } from '@/types';
import { OrderHistoryCard } from '@/components/order-history-card';

export default function ProfilePage() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams(); 
  const { toast } = useToast();
  const { translations } = useLocale();

  const userId = user?.id;
  const [orderHistory, setOrderHistory] = useState<{
    userId: string;
    orders: EnrichedOrder[];
    error?: string;
  } | null>(null);
  const currentHistory = orderHistory?.userId === userId ? orderHistory : null;
  const orders = currentHistory?.orders ?? [];
  const isLoadingOrders = !currentHistory;
  const errorLoadingOrders = currentHistory?.error;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/profile');
    }
  }, [user, authLoading, router]);
  
  useEffect(() => {
    if (searchParams.get('orderSuccess') === 'true') {
      toast({
        title: translations.profilePage.orderPlacedToastTitle,
        description: translations.profilePage.orderPlacedToastDesc,
      });
      const newPath = window.location.pathname; 
      window.history.replaceState({...window.history.state, as: newPath, url: newPath }, '', newPath);
    }
  }, [searchParams, toast, translations]);

  useEffect(() => {
    setOrderHistory(null);
    if (authLoading || !userId) return;

    let active = true;
    async function fetchOrders(id: string) {
      try {
        const orders = await getUserOrders(id);
        if (active) setOrderHistory({ userId: id, orders });
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error && error.message
          ? error.message
          : translations.profilePage.errorLoadingOrders;
        console.error("Error fetching user orders:", error);
        setOrderHistory({ userId: id, orders: [], error: message });
        toast({
          title: translations.common.error,
          description: message,
          variant: 'destructive',
        });
      }
    }
    void fetchOrders(userId);
    return () => { active = false; };
  }, [userId, authLoading, toast, translations]);


  const handleCancelOrder = async (orderId: string) => {
    if (!user?.id) {
      toast({ title: translations.common.error, description: translations.profilePage.userNotAuthenticatedToCancel, variant: 'destructive' });
      return false;
    }
    
    try {
      await cancelOrderService(orderId, user.id);
      toast({ title: translations.profilePage.orderCancelledTitle, description: translations.profilePage.orderCancelledDesc });
      
      setOrderHistory((history) => history?.userId === user.id ? {
        ...history,
        orders: history.orders.map((order) => order.id === orderId ? { ...order, status: 'cancelled' } : order),
      } : history);
      
      return true;
    } catch (error: unknown) {
      toast({ title: translations.common.error, description: error instanceof Error ? error.message : translations.profilePage.orderCancellationFailedDesc, variant: 'destructive' });
      return false;
    }
  };


  if (authLoading || (!user && authLoading)) { 
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader text={translations.profilePage.loadingProfile} size={48} />
      </div>
    );
  }
  
  if (!user) return null;


  const getInitials = (name?: string | null) => {
    if (!name?.trim()) return 'U';
    const names = name.trim().split(' ').filter(Boolean);
    if (names.length > 1) {
      return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
    }
    if (names.length === 1 && names[0].length > 1) {
      return names[0].substring(0, 2).toUpperCase();
    }
    if (names.length === 1) {
        return names[0][0].toUpperCase();
    }
    return 'U';
  };


  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="text-center">
        <h1 className="font-headline text-4xl font-bold text-primary">{translations.profilePage.title}</h1>
        <p className="text-lg text-muted-foreground">{translations.profilePage.tagline}</p>
      </header>

      <Card className="shadow-xl">
        <CardHeader className="flex flex-col items-center text-center border-b pb-6 bg-card/50 rounded-t-lg">
          <Avatar className="h-24 w-24 mb-4 ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md">
            <AvatarFallback className="text-3xl bg-primary/20 text-primary font-headline">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <CardTitle className="font-headline text-2xl">{user.name || translations.profilePage.valuedCustomer}</CardTitle>
          {user.email && (
            <CardDescription className="flex items-center gap-1 text-muted-foreground">
              <Mail className="h-4 w-4" /> {user.email}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div>
            <h3 className="font-headline text-lg font-semibold mb-3 text-foreground/90 flex items-center">
                <UserIcon className="mr-2 h-5 w-5 text-primary"/>
                {translations.profilePage.accountInfo}
            </h3>
            <div className="space-y-2 text-sm p-4 bg-muted/30 rounded-md border">
              <p><strong className="text-foreground/80">{translations.profilePage.nameLabel}</strong> {user.name || translations.profilePage.notSet}</p>
              <p><strong className="text-foreground/80">{translations.profilePage.emailLabel}</strong> {user.email || translations.profilePage.notSet}</p>
              {user.phone_number && (
                <p><strong className="text-foreground/80">{translations.profilePage.phoneNumberLabel}</strong> {user.phone_number}</p>
              )}
            </div>
             <Button variant="outline" size="sm" className="mt-4" disabled>
                <Edit3 className="mr-2 h-4 w-4" /> {translations.buttons.editProfile}
            </Button>
          </div>
          
          <div className="border-t pt-6">
            <h3 className="font-headline text-lg font-semibold mb-4 text-foreground/90 flex items-center">
                <History className="mr-2 h-5 w-5 text-primary" />
                {translations.profilePage.orderHistory}
            </h3>
            {isLoadingOrders && <Loader text={translations.profilePage.loadingOrders} />}
            {!isLoadingOrders && errorLoadingOrders && (
              <div className="text-center py-6 bg-destructive/10 text-destructive border border-destructive/30 rounded-md flex flex-col items-center">
                <AlertTriangle className="mx-auto h-12 w-12 mb-2" />
                <p className="font-semibold">{translations.common.error}</p>
                <p>{errorLoadingOrders}</p>
              </div>
            )}
            {!isLoadingOrders && !errorLoadingOrders && orders.length > 0 && (
              <div className="space-y-4">
                {orders.map(order => (
                  <OrderHistoryCard 
                    key={order.id} 
                    order={order} 
                    currentUser={user}
                    onOrderCancelled={handleCancelOrder}
                  />
                ))}
              </div>
            )}
            {!isLoadingOrders && !errorLoadingOrders && orders.length === 0 && (
              <div className="text-center py-10 bg-muted/50 rounded-md border">
                  <PackageCheck className="mx-auto h-16 w-16 text-muted-foreground mb-3" />
                  <p className="font-semibold text-lg text-foreground">{translations.profilePage.noPastOrders}</p>
                  <p className="text-muted-foreground text-sm mb-3">{translations.profilePage.noPastOrdersHint}</p>
                  <Button variant="default" asChild className="mt-2 text-primary-foreground">
                      <Link href="/products">{translations.profilePage.startShoppingLink}</Link>
                  </Button>
              </div>
            )}
          </div>

          <Button variant="destructive" onClick={logout} className="w-full mt-6">
            <LogOut className="mr-2 h-5 w-5" /> {translations.buttons.logout}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
