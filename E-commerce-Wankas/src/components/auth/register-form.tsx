
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Loader } from '../ui/loader';
import { UserPlus } from 'lucide-react';
import { useLocale } from '@/context/locale-context';
import { supabase } from '@/lib/supabaseClient';
import { registerWithSupabase } from '@/lib/registrationFlow';

export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const { translations } = useLocale();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: translations.common.error, description: translations.registerForm.passwordMismatch, variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
        toast({ title: translations.common.error, description: 'La contraseña debe tener al menos 6 caracteres.', variant: 'destructive' });
        return;
    }

    setIsLoading(true);

    try {
        if (!supabase) {
            toast({
                title: translations.common.error,
                description: 'El servicio de base de datos no está disponible.',
                variant: 'destructive',
            });
            setIsLoading(false);
            return;
        }

        await registerWithSupabase(supabase.auth, { email, password, name }, {
          onAuthenticated: () => {
            toast({ title: translations.registerForm.registrationSuccessTitle, description: translations.registerForm.registrationSuccessDesc });
            router.push('/profile');
          },
          onConfirmationRequired: () => {
            toast({
              title: translations.registerForm.confirmEmailTitle,
              description: translations.registerForm.confirmEmailDesc,
            });
          },
          onError: error => toast({
            title: translations.registerForm.dbErrorTitle,
            description: error.message,
            variant: 'destructive',
          }),
          onUnexpected: () => toast({ title: translations.common.error, description: translations.registerForm.dbErrorDefault, variant: 'destructive' }),
        });
    } catch (error) {
        console.error('No se pudo completar el registro.');
        toast({ title: translations.common.error, description: translations.registerForm.dbErrorDefault, variant: 'destructive' });
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center">
        <CardTitle className="font-headline text-3xl text-primary flex items-center justify-center">
            <UserPlus className="mr-2 h-8 w-8" /> {translations.registerForm.title}
        </CardTitle>
        <CardDescription>{translations.registerForm.description}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{translations.registerForm.nameLabel}</Label>
            <Input
              id="name"
              type="text"
              placeholder={translations.registerForm.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{translations.loginForm.emailLabel}</Label>
            <Input
              id="email"
              type="email"
              placeholder={translations.loginForm.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{translations.loginForm.passwordLabel}</Label>
            <Input
              id="password"
              type="password"
              placeholder={translations.loginForm.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{translations.registerForm.confirmPasswordLabel}</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder={translations.loginForm.passwordPlaceholder}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? <Loader size={20} className="mr-2" /> : <UserPlus className="mr-2 h-5 w-5" />}
            {isLoading ? translations.registerForm.creatingAccount : translations.registerForm.registerButton}
          </Button>
          <p className="text-sm text-muted-foreground">
            {translations.registerForm.haveAccount}{' '}
            <Button variant="link" asChild className="p-0 h-auto text-primary">
              <Link href="/login">{translations.registerForm.loginHere}</Link>
            </Button>
          </p>
          <div className="border-t border-border/60 w-full my-1" />
          <p className="text-xs text-muted-foreground text-center">
            ¿Eres parte del equipo Wanka's?{' '}
            <Button variant="link" asChild className="p-0 h-auto text-primary font-medium text-xs">
              <a href={(() => {
                const url = process.env.NEXT_PUBLIC_ADMIN_URL || "http://localhost:9002";
                return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') ? url : `https://${url}`;
              })()}>
                Inicia sesión en el Portal del Staff →
              </a>
            </Button>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
