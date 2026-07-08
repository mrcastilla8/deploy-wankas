'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { mainNav, userNav } from '@/config/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { useCart } from '@/context/cart-context';
import { useLocale } from '@/context/locale-context';
import type { NavTranslationKey } from '@/types';
import { ShoppingCart, Menu, LogOut, Languages, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


export function Header() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { getItemCount } = useCart();
  const { locale, translations, setLocale } = useLocale();
  const cartItemCount = getItemCount();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const NavLink = ({ href, children, icon: Icon, isSheetClose = false }: { href: string; children: React.ReactNode; icon?: React.ElementType; isSheetClose?: boolean }) => {
    const linkContent = (
      <>
        {Icon && <Icon className="h-4 w-4" />}
        {children}
      </>
    );

    const commonLinkProps = {
      className: cn(
        "flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary",
        pathname === href ? "text-primary" : "text-foreground/80"
      ),
      onClick: () => {
        if (isSheetClose) setIsMobileMenuOpen(false);
      }
    };

    if (isSheetClose) {
      return (
        <SheetClose asChild>
          <Link href={href} {...commonLinkProps}>
            {linkContent}
          </Link>
        </SheetClose>
      );
    }

    return (
      <Link href={href} {...commonLinkProps}>
        {linkContent}
      </Link>
    );
  };

  const renderNavLinks = (navItems: typeof mainNav, isSheetClose = false) => navItems
    .filter(item => !(item.authRequired && !user))
    .filter(item => !(item.hideWhenAuthed && user))
    .map(item => (
      <NavLink key={item.href} href={item.href} icon={item.icon} isSheetClose={isSheetClose}>
        {translations.nav[item.titleKey as NavTranslationKey] || item.titleKey}
      </NavLink>
    ));

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm">
      <div className="container flex h-16 max-w-screen-2xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2" onClick={() => setIsMobileMenuOpen(false)}>
          <ShoppingCart className="h-7 w-7 text-primary" />
          <span className="font-headline text-2xl font-bold text-primary">{translations.SITE_TITLE.split(' ')[0]}</span>
        </Link>

        <nav className="hidden md:flex items-center gap-4">
          {renderNavLinks(mainNav)}
          {renderNavLinks(userNav)}
          {user && (user.role === 'admin' || user.role === 'worker') && (
            <a
              href={(() => {
                const url = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:9002';
                return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') ? url : `https://${url}`;
              })()}
              className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary text-foreground/80"
            >
              <ShieldAlert className="h-4 w-4 text-primary" />
              Panel Admin
            </a>
          )}
          {user && (
            <Button variant="ghost" size="sm" onClick={logout} className="text-foreground/80 hover:text-primary">
              <LogOut className="h-4 w-4 mr-2" /> {translations.nav.logout}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={translations.common.language}>
                <Languages className="h-5 w-5" />
                <span className="sr-only">{translations.common.language}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLocale('en')} disabled={locale === 'en'}>
                {translations.common.english}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale('es')} disabled={locale === 'es'}>
                {translations.common.spanish}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          <Link href="/cart" className="relative p-2" onClick={() => setIsMobileMenuOpen(false)}>
            <ShoppingCart className="h-6 w-6 text-foreground/80 hover:text-primary" />
            {cartItemCount > 0 && (
              <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {cartItemCount}
              </span>
            )}
            <span className="sr-only">{translations.nav.cart}</span>
          </Link>
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={translations.common.language}>
                <Languages className="h-6 w-6" />
                <span className="sr-only">{translations.common.language}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLocale('en')} disabled={locale === 'en'}>
                {translations.common.english}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale('es')} disabled={locale === 'es'}>
                {translations.common.spanish}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full max-w-xs bg-background p-6">
              <div className="flex flex-col gap-6">
                <SheetClose asChild>
                  <Link href="/" className="mb-4 flex items-center gap-2 self-start">
                    <ShoppingCart className="h-7 w-7 text-primary" />
                    <span className="font-headline text-2xl font-bold text-primary">{translations.SITE_TITLE.split(' ')[0]}</span>
                  </Link>
                </SheetClose>
                {renderNavLinks(mainNav, true)}
                {renderNavLinks(userNav, true)} 
                {user && (user.role === 'admin' || user.role === 'worker') && (
                  <SheetClose asChild>
                    <a
                      href={(() => {
                        const url = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:9002';
                        return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/') ? url : `https://${url}`;
                      })()}
                      className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary text-foreground/80 justify-start py-2"
                    >
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      Panel Admin
                    </a>
                  </SheetClose>
                )}
                {user && (
                  <SheetClose asChild>
                    <Button variant="ghost" onClick={logout} className="w-full justify-start text-foreground/80 hover:text-primary">
                      <LogOut className="h-4 w-4 mr-2" /> {translations.nav.logout}
                    </Button>
                  </SheetClose>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
