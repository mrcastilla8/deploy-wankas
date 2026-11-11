
"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"

import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "./ui/button"

import {
  LayoutGrid,
  ShoppingCart,
  Package,
  MapPin,
  BarChart2,
  LogOut,
  UserCircle,
  Users,
} from "lucide-react"

export function DashboardNav() {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  const navItems =
    user?.role === "admin"
      ? [
          { href: "/dashboard", icon: LayoutGrid, label: "Resumen" },
          { href: "/dashboard/pedidos", icon: ShoppingCart, label: "Pedidos" },
          { href: "/dashboard/catalogo", icon: Package, label: "Catálogo" },
          { href: "/dashboard/ubicaciones", icon: MapPin, label: "Ubicaciones" },
          { href: "/dashboard/usuarios", icon: Users, label: "Usuarios" },
          { href: "/dashboard/informes", icon: BarChart2, label: "Informes" },
        ]
      : [
          { href: "/dashboard/pedidos", icon: ShoppingCart, label: "Mis Pedidos" },
        ]

  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-3 p-2">
            <h1 className="font-headline text-2xl font-bold text-primary">Wanka&apos;s</h1>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <div className="p-2 space-y-2">
            <div className="flex items-center gap-3">
                <Avatar>
                    <AvatarImage src={`https://i.pravatar.cc/150?u=${user?.id}`} />
                    <AvatarFallback>
                        {user?.name ? user.name.charAt(0).toUpperCase() : <UserCircle />}
                    </AvatarFallback>
                </Avatar>
                <div className="flex flex-col text-sm">
                    <span className="font-semibold">{user?.name}</span>
                    <span className="text-muted-foreground">{user?.email}</span>
                </div>
            </div>
            <Button variant="ghost" className="w-full justify-start" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
            </Button>
        </div>
      </SidebarFooter>
    </>
  )
}
