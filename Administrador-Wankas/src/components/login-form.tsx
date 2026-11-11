"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, user, loading } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      if (user.role === 'worker') {
        router.replace('/seleccionar-sede');
      } else {
        router.replace('/dashboard');
      }
    }
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <Card className="w-full max-w-md shadow-lg flex items-center justify-center p-8 min-h-[250px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Cargando sesión...</p>
        </div>
      </Card>
    );
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const { error } = await login(email, password);
    if (error) {
      toast({
        variant: "destructive",
        title: "Error de autenticación",
        description: error.message,
      });
    }
  };

  return (
    <Card className="w-full max-w-md shadow-lg">
      <form onSubmit={handleLogin}>
        <CardHeader>
          <CardTitle className="font-headline text-2xl">Iniciar Sesión</CardTitle>
          <CardDescription>Ingrese sus credenciales para acceder.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo Electrónico</Label>
            <Input 
              id="email" 
              type="email" 
              placeholder="admin@wanka.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input 
              id="password" 
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" style={{ backgroundColor: 'hsl(var(--accent))', color: 'hsl(var(--accent-foreground))' }}>
            Ingresar
          </Button>
          <div className="border-t border-border/60 w-full my-1" />
          <p className="text-sm text-muted-foreground text-center">
            ¿Buscas comprar nuestros productos?{' '}
            <a 
              href={(() => {
                const url = process.env.NEXT_PUBLIC_ECOMMERCE_URL || 'http://localhost:9000';
                return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') ? url : `https://${url}`;
              })()}
              className="hover:underline font-medium block mt-1"
              style={{ color: 'hsl(var(--accent))' }}
            >
              Ir a la Tienda Online →
            </a>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
