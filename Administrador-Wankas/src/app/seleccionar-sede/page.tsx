
"use client"

import * as React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import type { Location } from '@/types';
import { adminRequest, describeAdminError } from '@/lib/adminApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin } from 'lucide-react';

type AssignedLocation = Pick<Location, 'id' | 'name_es' | 'address'>;

type LocationState =
    | { status: 'loading' }
    | { status: 'unassigned' }
    | { status: 'assigned'; location: AssignedLocation }
    | { status: 'error'; message: string };

/**
 * REC-05: el trabajador no elige su sede. La sede viene de `profiles.location_id`
 * (REC-01), la administra un admin (REC-03) y aquí solo se muestra.
 */
export default function SelectLocationPage() {
    const { user, updateUser, logout, loading } = useAuth();
    const router = useRouter();
    const [state, setState] = React.useState<LocationState>({ status: 'loading' });

    React.useEffect(() => {
        if (loading) return;
        if (!user) {
            router.replace('/');
        } else if (user.role !== 'worker') {
            router.replace('/dashboard');
        }
    }, [user, loading, router]);

    const assignedLocationId = user?.role === 'worker' ? user.location_id : null;

    const loadAssignedLocation = React.useCallback(async () => {
        if (!assignedLocationId) {
            setState({ status: 'unassigned' });
            return;
        }
        setState({ status: 'loading' });
        try {
            const locations = await adminRequest<AssignedLocation[]>('/api/admin/ubicaciones');
            const location = locations.find(loc => loc.id === assignedLocationId);
            setState(location
                ? { status: 'assigned', location }
                : { status: 'error', message: 'Tu sede asignada ya no existe. Pide a un administrador que la revise.' });
        } catch (error) {
            setState({ status: 'error', message: describeAdminError(error) });
        }
    }, [assignedLocationId]);

    React.useEffect(() => {
        if (!loading && user?.role === 'worker') {
            loadAssignedLocation();
        }
    }, [loading, user?.role, loadAssignedLocation]);

    const handleContinue = () => {
        if (state.status !== 'assigned') return;
        // Solo se guarda el nombre para mostrarlo; la sede autorizada la decide el servidor.
        updateUser({ locationName: state.location.name_es });
        router.push('/dashboard/pedidos');
    };

    if (loading || !user || user.role !== 'worker' || state.status === 'loading') {
        return (
            <div className="flex h-screen items-center justify-center">
                 <div className="w-full max-w-md p-4 space-y-4">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            </div>
        )
    }

    return (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="font-headline text-2xl">Tu sede de trabajo</CardTitle>
                    <CardDescription>
                        {state.status === 'assigned'
                            ? 'Esta es la sede que tienes asignada. Solo verás los pedidos de esta sede.'
                            : 'No puedes continuar al panel sin una sede asignada.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {state.status === 'assigned' && (
                        <div className="flex items-start gap-3 rounded-md border p-4">
                            <MapPin className="mt-0.5 h-5 w-5 text-primary" />
                            <div>
                                <p className="font-semibold">{state.location.name_es}</p>
                                <p className="text-sm text-muted-foreground">{state.location.address}</p>
                            </div>
                        </div>
                    )}
                    {state.status === 'unassigned' && (
                        <p className="text-sm text-muted-foreground">
                            Todavía no tienes una sede asignada. Pide a un administrador que te asigne una
                            y vuelve a iniciar sesión.
                        </p>
                    )}
                    {state.status === 'error' && (
                        <p className="text-sm text-destructive">{state.message}</p>
                    )}
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                    {state.status === 'assigned' && (
                        <Button onClick={handleContinue} className="w-full">Continuar al Panel</Button>
                    )}
                    {state.status === 'error' && (
                        <Button onClick={loadAssignedLocation} className="w-full">Reintentar</Button>
                    )}
                    <Button onClick={logout} variant="outline" className="w-full">Cerrar sesión</Button>
                </CardFooter>
            </Card>
        </main>
    )
}
