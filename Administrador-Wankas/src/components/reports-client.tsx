
"use client"

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable, { type UserOptions } from 'jspdf-autotable';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, type TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Order, Product, Location as LocationType } from '@/types';
import { Download, DollarSign, ShoppingCart, Package, TrendingUp, BarChart2 } from 'lucide-react';
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth, subMonths, subDays, endOfDay as dateFnsEndOfDay } from 'date-fns';
import { es } from 'date-fns/locale';

const getTimeRange = (range: string): { start: Date, end: Date } => {
    const now = new Date();
    const end = dateFnsEndOfDay(now);

    switch (range) {
        case '7d':
            return { start: subDays(now, 7), end };
        case '30d':
            return { start: subDays(now, 30), end };
        case 'lastMonth':
            const lastMonthStart = startOfMonth(subMonths(now, 1));
            return { start: lastMonthStart, end: endOfMonth(lastMonthStart) };
        default:
            return { start: subDays(now, 6), end }; 
    }
};

// jspdf-autotable guarda la posición final de la última tabla en el documento, sin tiparla.
type JsPdfWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } };

const CustomTooltip = ({ active, payload, label }: TooltipProps<ValueType, NameType>) => {
    if (active && payload && payload.length) {
      return (
        <div className="p-2 bg-background/90 border border-border rounded-lg shadow-lg text-sm">
          <p className="label font-bold mb-1">{label}</p>
          {payload.map((pld, index) => (
            <p key={index} style={{ color: pld.color }} className="flex items-center">
              <span className="mr-2">{pld.name}:</span>
              <span className="font-semibold">
                {String(pld.dataKey).toLowerCase().includes('ventas') || String(pld.dataKey).toLowerCase().includes('ticketpromedio')
                ? `S/ ${Number(pld.value).toFixed(2)}` 
                : pld.value}
              </span>
            </p>
          ))}
        </div>
      );
    }
    return null;
};

const renderEmptyState = (message: string, description: string, height: number = 350) => (
    <div style={{height: `${height}px`}} className="flex w-full items-center justify-center text-center text-muted-foreground p-4">
        <div>
            <BarChart2 className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p className="font-semibold">{message}</p>
            <p className="text-sm">{description}</p>
        </div>
    </div>
);

export default function ReportsClient() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('sales');
    const [timeRange, setTimeRange] = useState('30d');
    
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [locations, setLocations] = useState<LocationType[]>([]);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    const fetchReportData = useCallback(async () => {
        setLoading(true);
        const { data: ordersData, error: ordersError } = await supabase
            .from('orders')
            .select('*, order_items(*, products(*, categories(*))), locations(*)');
        
        const { data: productsData, error: productsError } = await supabase.from('products').select('*');
        const { data: locationsData, error: locationsError } = await supabase.from('locations').select('*');

        if (ordersError || productsError || locationsError) {
            console.error("Error fetching report data:", ordersError || productsError || locationsError);
        } else {
            setOrders((ordersData ?? []) as Order[]);
            setProducts(productsData || []);
            setLocations(locationsData || []);
        }
        setLoading(false);
    }, [supabase]);

    useEffect(() => {
        if (user?.role === 'admin') {
            fetchReportData();
        } else {
            setLoading(false);
        }
    }, [user, fetchReportData]);

    const filteredOrders = useMemo(() => {
        if (!orders) return [];
        const { start, end } = getTimeRange(timeRange);
        return orders.filter(o => {
            if (!o.order_date) return false;
            try {
                const orderDate = parseISO(o.order_date);
                return isWithinInterval(orderDate, { start, end });
            } catch (error) {
                console.warn(`Invalid date format for order ${o.id}: ${o.order_date}`);
                return false;
            }
        });
    }, [orders, timeRange]);

    const completedOrders = useMemo(() => filteredOrders.filter(o => o.status === 'completed'), [filteredOrders]);
    
    const salesReportData = useMemo(() => {
        const totalRevenue = completedOrders.reduce((acc, order) => acc + (order.total_price || 0), 0);
        const totalCompletedOrders = completedOrders.length;
        const averageTicket = totalCompletedOrders > 0 ? totalRevenue / totalCompletedOrders : 0;

        const salesByDay = completedOrders.reduce((acc, order) => {
            try {
                const day = format(parseISO(order.order_date), 'yyyy-MM-dd');
                if (!acc[day]) acc[day] = { date: day, ventas: 0, pedidos: 0 };
                acc[day].ventas += order.total_price || 0;
                acc[day].pedidos += 1;
            } catch (e) { }
            return acc;
        }, {} as Record<string, { date: string, ventas: number, pedidos: number }>);
        
        const chartData = Object.values(salesByDay)
            .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map(item => ({
                ...item,
                name: format(parseISO(item.date), 'MMM d', { locale: es }),
            }));
        
        return { totalRevenue, totalCompletedOrders, averageTicket, chartData };
    }, [completedOrders]);

    const categoryReportData = useMemo(() => {
        const salesByCategory = completedOrders.flatMap(o => o.order_items || []).reduce((acc, item) => {
            if (!item.products?.categories) return acc;
            const categoryName = item.products.categories.name_es || 'Sin Categoría';
            acc[categoryName] = (acc[categoryName] || 0) + ((item.price_at_purchase || 0) * (item.quantity || 0));
            return acc;
        }, {} as Record<string, number>);
        
        const topCategories = Object.entries(salesByCategory)
            .map(([name, ventas]) => ({ name, ventas }))
            .sort((a, b) => b.ventas - a.ventas).slice(0, 5);
            
        const salesByProduct = completedOrders.flatMap(o => o.order_items || []).reduce((acc, item) => {
            if (!item.products) return acc;
            const productName = item.products.name_es || 'Producto Desconocido';
            acc[productName] = (acc[productName] || 0) + (item.quantity || 0);
            return acc;
        }, {} as Record<string, number>);

        const topProducts = Object.entries(salesByProduct)
            .map(([name, cantidad]) => ({ name, cantidad }))
            .sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);

        return { topCategories, topProducts };
    }, [completedOrders]);

    const locationReportData = useMemo(() => {
        const salesByLocation = completedOrders.reduce((acc, order) => {
            const locationName = order.locations?.name_es || 'Sin Ubicación';
            if (!acc[locationName]) acc[locationName] = { ventas: 0, pedidos: 0, ticketPromedio: 0 };
            acc[locationName].ventas += order.total_price || 0;
            acc[locationName].pedidos += 1;
            return acc;
        }, {} as Record<string, { ventas: number, pedidos: number, ticketPromedio: number }>);

        const chartData = Object.entries(salesByLocation).map(([name, data]) => ({
            name,
            ...data,
            ticketPromedio: data.pedidos > 0 ? data.ventas / data.pedidos : 0,
        })).sort((a, b) => b.ventas - a.ventas);

        return { chartData };
    }, [completedOrders]);

    const stockReportData = useMemo(() => {
        return products.filter(p => p.stock != null && p.stock <= 20).sort((a,b) => (a.stock ?? 0) - (b.stock ?? 0));
    }, [products]);
    
    const handleDownloadPdf = () => {
        const doc = new jsPDF() as JsPdfWithAutoTable;
        const timeRangeText = {
            '7d': 'Últimos 7 días',
            '30d': 'Últimos 30 días',
            'lastMonth': 'Mes pasado',
        }[timeRange];

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor('#D4A626'); 
        doc.text("Reporte de Wanka's", 14, 22);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(100); 
        doc.text(`Período: ${timeRangeText}`, 14, 30);
        
        let finalY = 35;
        const tableOptions: Pick<UserOptions, 'theme' | 'headStyles' | 'styles'> = {
            theme: 'grid',
            headStyles: { fillColor: '#8B4513' }, 
            styles: { font: 'helvetica', cellPadding: 2, fontSize: 9 },
        };

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(40); 
        doc.text("Reporte de Ventas", 14, finalY + 10);
        autoTable(doc, {
            ...tableOptions,
            startY: finalY + 15,
            head: [['Métrica', 'Valor']],
            body: [
                ['Ingresos Totales', `S/ ${salesReportData.totalRevenue.toFixed(2)}`],
                ['Pedidos Completados', salesReportData.totalCompletedOrders.toString()],
                ['Ticket Promedio', `S/ ${salesReportData.averageTicket.toFixed(2)}`],
            ],
        });
        finalY = doc.lastAutoTable.finalY;

        if (categoryReportData.topCategories.length > 0 || categoryReportData.topProducts.length > 0) {
            doc.setFontSize(14);
            doc.text("Reporte por Categoría y Producto", 14, finalY + 15);
            finalY += 15;

            if (categoryReportData.topCategories.length > 0) {
                 autoTable(doc, {
                    ...tableOptions,
                    startY: finalY + 5,
                    head: [['Top 5 Categorías por Ventas', 'Ventas (S/)']],
                    body: categoryReportData.topCategories.map(c => [c.name, `S/ ${c.ventas.toFixed(2)}`]),
                });
                finalY = doc.lastAutoTable.finalY;
            }

            if (categoryReportData.topProducts.length > 0) {
                autoTable(doc, {
                    ...tableOptions,
                    head: [['Top 5 Productos por Cantidad', 'Cantidad Vendida']],
                    body: categoryReportData.topProducts.map(p => [p.name, p.cantidad]),
                    startY: finalY + 10
                });
                finalY = doc.lastAutoTable.finalY;
            }
        }

        if (locationReportData.chartData.length > 0) {
            doc.setFontSize(14);
            doc.text("Reporte de Rendimiento por Ubicación", 14, finalY + 15);
            autoTable(doc, {
                ...tableOptions,
                startY: finalY + 20,
                head: [['Ubicación', 'Ventas (S/)', 'Pedidos', 'Ticket Promedio (S/)']],
                body: locationReportData.chartData.map(l => [
                    l.name, 
                    `S/ ${l.ventas.toFixed(2)}`,
                    l.pedidos,
                    `S/ ${l.ticketPromedio.toFixed(2)}`
                ]),
            });
            finalY = doc.lastAutoTable.finalY;
        }

         if (stockReportData.length > 0) {
            doc.setFontSize(14);
            doc.text("Reporte de Stock Bajo", 14, finalY + 15);
            autoTable(doc, {
                ...tableOptions,
                startY: finalY + 20,
                head: [['Producto', 'Stock Actual']],
                body: stockReportData.map(p => [p.name_es, p.stock]),
            });
         }

        doc.save(`informe-completo-wankas-${new Date().toISOString().slice(0,10)}.pdf`);
    };

    if (user?.role !== 'admin') {
      return <p>Acceso denegado.</p>;
    }
  
    if (loading) {
      return <p>Cargando informes...</p>;
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="Seleccionar período" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7d">Últimos 7 días</SelectItem>
                        <SelectItem value="30d">Últimos 30 días</SelectItem>
                        <SelectItem value="lastMonth">Mes pasado</SelectItem>
                    </SelectContent>
                </Select>
                <Button onClick={handleDownloadPdf} className="bg-accent text-accent-foreground hover:bg-accent/90 w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    Generar Informe PDF
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
                    <TabsTrigger value="sales">Ventas</TabsTrigger>
                    <TabsTrigger value="categories">Categorías y Productos</TabsTrigger>
                    <TabsTrigger value="locations">Ubicaciones</TabsTrigger>
                    <TabsTrigger value="stock">Stock</TabsTrigger>
                </TabsList>

                <TabsContent value="sales">
                    <div className="space-y-6 p-4 bg-card">
                        <CardTitle className="font-headline">Reporte de Ventas Netas Totales</CardTitle>
                        <div className="grid gap-4 md:grid-cols-3">
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Ingresos Totales</CardTitle>
                                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">S/ {salesReportData.totalRevenue.toFixed(2)}</div>
                                    <p className="text-xs text-muted-foreground">En el período seleccionado</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Pedidos Completados</CardTitle>
                                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{salesReportData.totalCompletedOrders}</div>
                                    <p className="text-xs text-muted-foreground">En el período seleccionado</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-sm font-medium">Ticket Promedio</CardTitle>
                                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">S/ {salesReportData.averageTicket.toFixed(2)}</div>
                                    <p className="text-xs text-muted-foreground">Promedio por pedido completado</p>
                                </CardContent>
                            </Card>
                        </div>
                        <Card>
                            <CardHeader>
                                <CardTitle>Tendencia de Ventas</CardTitle>
                                <CardDescription>Ventas netas por día en el período seleccionado.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {salesReportData.chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={350}>
                                    <LineChart data={salesReportData.chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis tickFormatter={(value) => `S/ ${value}`} />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend />
                                        <Line type="monotone" dataKey="ventas" stroke="hsl(var(--primary))" name="Ventas" />
                                    </LineChart>
                                </ResponsiveContainer>
                                ) : (
                                    renderEmptyState("Sin datos de ventas", "Prueba a seleccionar otro período de tiempo.")
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="categories">
                     <div className="space-y-6 p-4 bg-card">
                        <CardTitle className="font-headline">Reporte por Categoría y Producto</CardTitle>
                        <div className="grid gap-4 md:grid-cols-2">
                             <Card>
                                <CardHeader>
                                    <CardTitle>Top 5 Categorías por Ventas</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {categoryReportData.topCategories.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={300}>
                                        <BarChart data={categoryReportData.topCategories} layout="vertical" margin={{ left: 20, right: 20 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis type="number" tickFormatter={(value) => `S/ ${value}`} />
                                            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Bar dataKey="ventas" fill="hsl(var(--primary))" name="Ventas" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    ) : (
                                        renderEmptyState("Sin ventas de categorías", "No hay datos en este período.", 300)
                                    )}
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Top 5 Productos por Cantidad</CardTitle>
                                </CardHeader>
                                <CardContent>
                                {categoryReportData.topProducts.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Producto</TableHead>
                                                <TableHead className="text-right">Cantidad Vendida</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {categoryReportData.topProducts.map(p => (
                                                <TableRow key={p.name}>
                                                    <TableCell>{p.name}</TableCell>
                                                    <TableCell className="text-right">{p.cantidad}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    renderEmptyState("Sin productos vendidos", "No hay datos en este período.", 300)
                                )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="locations">
                    <div className="space-y-6 p-4 bg-card">
                         <CardTitle className="font-headline">Reporte de Rendimiento por Ubicación</CardTitle>
                         <Card>
                            <CardHeader>
                                <CardTitle>Rendimiento por Ubicación</CardTitle>
                                <CardDescription>Comparativa de ventas, pedidos y ticket promedio por ubicación.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {locationReportData.chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={350}>
                                     <BarChart data={locationReportData.chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" tick={false} />
                                        <YAxis />
                                        <Tooltip content={<CustomTooltip />} />
                                        <Legend />
                                        <Bar dataKey="ventas" fill="hsl(var(--chart-1))" name="Ventas (S/)" />
                                        <Bar dataKey="pedidos" fill="hsl(var(--chart-2))" name="Pedidos" />
                                        <Bar dataKey="ticketPromedio" fill="hsl(var(--chart-3))" name="Ticket Promedio (S/)" />
                                    </BarChart>
                                </ResponsiveContainer>
                                ) : (
                                    renderEmptyState("Sin datos de ubicaciones", "No hay pedidos completados en este período.")
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="stock">
                    <div className="space-y-6 p-4 bg-card">
                        <CardTitle className="font-headline">Reporte de Stock</CardTitle>
                        <Card>
                            <CardHeader>
                                <CardTitle>Productos con Bajo Stock ({"<="} 20 unidades)</CardTitle>
                                <CardDescription>Estos productos necesitan ser reabastecidos pronto.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {stockReportData.length > 0 ? (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Producto</TableHead>
                                                <TableHead className="text-right">Stock Actual</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {stockReportData.map(p => (
                                                <TableRow key={p.id}>
                                                    <TableCell>{p.name_es}</TableCell>
                                                    <TableCell className="text-right">{p.stock}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8">
                                        <Package className="h-12 w-12 mb-4" />
                                        <p className="font-semibold">¡Todo en orden!</p>
                                        <p className="text-sm">No hay productos con bajo stock actualmente.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
