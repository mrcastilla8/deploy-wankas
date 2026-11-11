import LoginForm from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold font-headline text-primary">Wanka&apos;s</h1>
          <p className="text-muted-foreground mt-2">Bienvenido. Inicia sesión para gestionar tu tienda.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
