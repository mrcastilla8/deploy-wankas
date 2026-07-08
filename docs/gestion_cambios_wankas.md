# Gestión de Cambios - Proyecto SECP-WNK (Wanka's)

Este documento presenta el registro y la bitácora del control de cambios aplicados sobre el sistema **Wanka's (Plataforma de Comercio Electrónico y Panel de Administración)**, bajo el identificador de proyecto **SECP-WNK (Wanka's)**.

Se detallan **5 Solicitudes de Cambio (SC)** simuladas que corresponden al mes de **septiembre de 2025**. Todas ellas han completado satisfactoriamente la etapa 6 y se encuentran en estado **"Implementado"**.

---

## 📌 Fases del Proceso de Gestión de Cambios (Referencia)
Para el desarrollo de estas solicitudes, se ha seguido el siguiente flujo metodológico:
1. **Recibir y Analizar la Petición**
2. **Clasificar el Cambio**
3. **Evaluación del Impacto y Riesgos**
4. **Aprobación del Cambio**
5. **Planificación y Calendarización**
6. **Implementación**
7. **Verificación de la Implementación**
8. **Cierre**

---

## 📋 1. Fichas de Solicitudes de Cambio (Detalle)

A continuación se detallan las 5 solicitudes de cambio en su formato extendido adaptado al proyecto:

### 🔹 Solicitud de Cambio 01 (SC010)
| Campo | Descripción |
| :--- | :--- |
| **ID** | SC010 |
| **Fecha** | 2025-09-01 (Fecha de Creación de la solicitud) |
| **Parte interesada (Fuente)** | Ventas - Wanka's |
| **Dueño del proceso (Autor)** | Diana Huamán Ríos |
| **Descripción del cambio** | Integración de pasarela de pagos en línea (MercadoPago API) en el módulo de checkout del sistema `E-commerce-Wankas`. |
| **Justificación** | Actualmente, la plataforma funciona bajo la modalidad de "recojo en tienda y pago al momento". La integración de pagos en línea permite reducir en un 35% los pedidos que son preparados pero nunca recogidos en tienda (mermas), además de agilizar los tiempos de atención en cajas físicas al reducir los pagos presenciales. |
| **Estado** | Implementado |
| **Fecha INI** | 2025-09-11 (Fecha de inicio de la planificación del cambio, etapa 5) |
| **Fecha FIN** | 2025-09-14 (Fecha de fin de la planificación del cambio, etapa 5) |

---

### 🔹 Solicitud de Cambio 02 (SC011)
| Campo | Descripción |
| :--- | :--- |
| **ID** | SC011 |
| **Fecha** | 2025-09-04 (Fecha de Creación de la solicitud) |
| **Parte interesada (Fuente)** | Marketing - Wanka's |
| **Dueño del proceso (Autor)** | Diana Huamán Ríos |
| **Descripción del cambio** | Optimización del Asistente de IA (Google Genkit/Gemini) en `E-commerce-Wankas` para admitir reconocimiento multiobjeto en imágenes de ingredientes de cocina. |
| **Justificación** | Los usuarios suelen subir fotos con múltiples ingredientes (ej. tomate, carne y cebolla) desde sus despensas, pero el modelo actual solo identifica el objeto predominante. Habilitar reconocimiento multiobjeto incrementará el uso del asistente en un 40% y mejorará drásticamente la relevancia en la sugerencia automatizada de recetas de Wanka's. |
| **Estado** | Implementado |
| **Fecha INI** | 2025-09-12 (Fecha de inicio de la planificación del cambio, etapa 5) |
| **Fecha FIN** | 2025-09-15 (Fecha de fin de la planificación del cambio, etapa 5) |

---

### 🔹 Solicitud de Cambio 03 (SC012)
| Campo | Descripción |
| :--- | :--- |
| **ID** | SC012 |
| **Fecha** | 2025-09-07 (Fecha de Creación de la solicitud) |
| **Parte interesada (Fuente)** | Marketing - Wanka's |
| **Dueño del proceso (Autor)** | Diana Huamán Ríos |
| **Descripción del cambio** | Implementación de un microservicio de mensajería automatizada (WhatsApp/Email) integrado a Supabase Database Webhooks para notificaciones en tiempo real del estado de pedidos. |
| **Justificación** | Actualmente, el cliente no tiene visibilidad de cuándo su pedido ha sido empaquetado y está listo en la sede seleccionada, a menos que visite la web. El envío automatizado de notificaciones al cambiar el estado del pedido a `ready_for_pickup` mejorará la puntualidad en los recojos y la satisfacción del usuario. |
| **Estado** | Implementado |
| **Fecha INI** | 2025-09-16 (Fecha de inicio de la planificación del cambio, etapa 5) |
| **Fecha FIN** | 2025-09-18 (Fecha de fin de la planificación del cambio, etapa 5) |

---

### 🔹 Solicitud de Cambio 04 (SC013)
| Campo | Descripción |
| :--- | :--- |
| **ID** | SC013 |
| **Fecha** | 2025-09-10 (Fecha de Creación de la solicitud) |
| **Parte interesada (Fuente)** | Ventas - Wanka's |
| **Dueño del proceso (Autor)** | Diana Huamán Ríos |
| **Descripción del cambio** | Incorporación de un módulo de actualización masiva de inventario mediante carga de archivos CSV e implementación de alertas visuales de Stock Mínimo de Seguridad (Safety Stock) en el panel `Administrador-Wankas`. |
| **Justificación** | Los operarios en sede demoran hasta 2 horas diarias actualizando manualmente el stock de productos de consumo masivo uno por uno. Adicionalmente, la falta de alertas preventivas ha provocado quiebres de stock en el e-commerce, lo cual genera cancelaciones de pedidos y descontento. |
| **Estado** | Implementado |
| **Fecha INI** | 2025-09-17 (Fecha de inicio de la planificación del cambio, etapa 5) |
| **Fecha FIN** | 2025-09-19 (Fecha de fin de la planificación del cambio, etapa 5) |

---

### 🔹 Solicitud de Cambio 05 (SC014)
| Campo | Descripción |
| :--- | :--- |
| **ID** | SC014 |
| **Fecha** | 2025-09-12 (Fecha de Creación de la solicitud) |
| **Parte interesada (Fuente)** | Ventas - Wanka's |
| **Dueño del proceso (Autor)** | Diana Huamán Ríos |
| **Descripción del cambio** | Ampliación del modelo lógico de datos en Supabase y de los controladores del Backend para soportar transacciones bimoneda (Soles - PEN y Dólares - USD) en productos, carritos y pedidos. |
| **Justificación** | Requerimiento estratégico comercial para poder cotizar y procesar pedidos del segmento de catering a empresas corporativas que manejan sus presupuestos en dólares americanos, facilitando la expansión comercial de la marca. |
| **Estado** | Implementado |
| **Fecha INI** | 2025-09-19 (Fecha de inicio de la planificación del cambio, etapa 5) |
| **Fecha FIN** | 2025-09-21 (Fecha de fin de la planificación del cambio, etapa 5) |

---

## 📊 2. Tabla Consolidada / Bitácora de Solicitudes de Cambio

Cada fila representa un resumen consolidado del flujo de control de cambios:

| ID | Fecha | Parte interesada | Dueño del proceso | Estado | Tipo de clasific. | Identificación CCC | Fecha INI | Fecha FIN | ID de Aprobación | Fecha de Recibido | Fecha de Observado | Fecha de Clasificación | Fecha de Evaluación | Fecha de Aprobación | Fecha de Rechazo | Fecha de Planificación | Fecha de Implementación | Fecha de Verificación | Fecha de Cierre |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SC010** | 2025-09-01 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-11 | 2025-09-14 | AP-WNK-101 | 2025-09-01 | — | 2025-09-03 | 2025-09-06 | 2025-09-10 | — | 2025-09-11 | 2025-09-22 | Pendiente | Pendiente |
| **SC011** | 2025-09-04 | Marketing - Wanka's | Diana Huamán Ríos | Implementado | Cambio Estándar | CCC-COM-009 | 2025-09-12 | 2025-09-15 | AP-WNK-102 | 2025-09-04 | — | 2025-09-05 | 2025-09-08 | 2025-09-11 | — | 2025-09-12 | 2025-09-20 | Pendiente | Pendiente |
| **SC012** | 2025-09-07 | Marketing - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-16 | 2025-09-18 | AP-WNK-103 | 2025-09-07 | 2025-09-08 | 2025-09-09 | 2025-09-12 | 2025-09-15 | — | 2025-09-16 | 2025-09-26 | Pendiente | Pendiente |
| **SC013** | 2025-09-10 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Estándar | CCC-COM-009 | 2025-09-17 | 2025-09-19 | AP-WNK-104 | 2025-09-10 | — | 2025-09-11 | 2025-09-14 | 2025-09-16 | — | 2025-09-17 | 2025-09-28 | Pendiente | Pendiente |
| **SC014** | 2025-09-12 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-19 | 2025-09-21 | AP-WNK-105 | 2025-09-12 | — | 2025-09-13 | 2025-09-15 | 2025-09-18 | — | 2025-09-19 | 2025-09-30 | Pendiente | Pendiente |

> [!NOTE]
> * La **Fecha de Observado** para SC012 corresponde al 2025-09-08, día en que la Jefatura de Seguridad de la Información solicitó precisiones sobre el consumo de la API de mensajería y la política de privacidad de datos de los clientes. El detalle fue subsanado, clasificado y evaluado satisfactoriamente en las fechas posteriores.
> * Las columnas de **Fecha de Verificación** y **Fecha de Cierre** se encuentran en estado *Pendiente* dado que las solicitudes están actualmente en fase de despliegue en producción e inicio del periodo de monitoreo (fase Implementada).

---

## 📈 3. Reporte de Control de Cambios Mensual

A continuación, se presenta la simulación del reporte del sistema tras filtrar los cambios en estado **"Implementado"** ejecutados durante septiembre de 2025 para el proyecto **SECP-WNK (Wanka's)**.

| Reporte para las solicitudes de cambio | |
| :--- | :--- |
| **Título** | Lista de Solicitudes de Cambio (SC) en estado "Implementado" (etapa 6) y tienen asignado el CCC |
| **Entradas** | **Estado:** Implementado |
| | **Fecha Inicio:** 2025-09-01 |
| | **Fecha Fin:** 2025-09-30 |
| **Acción** | Generar Reporte |

### Resultado del reporte:
**Lista de Solicitudes de Cambio (SC) en estado "Implementado" (etapa 6) y tienen asignado el CCC — Proyecto SECP-WNK (Wanka's)**

| ID | Fecha | Parte interesada | Dueño del proceso | Estado | Tipo de clasific. | Identificación CCC | Fecha INI | Fecha FIN | ID de Aprobación | Fecha de Recibido | Fecha de Observado | Fecha de Clasificación | Fecha de Evaluación | Fecha de Aprobación | Fecha de Rechazo | Fecha de Planificación | Fecha de Implementación | Fecha de Verificación | Fecha de Cierre |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SC010** | 2025-09-01 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-11 | 2025-09-14 | AP-WNK-101 | 2025-09-01 | — | 2025-09-03 | 2025-09-06 | 2025-09-10 | — | 2025-09-11 | 2025-09-22 | — | — |
| **SC011** | 2025-09-04 | Marketing - Wanka's | Diana Huamán Ríos | Implementado | Cambio Estándar | CCC-COM-009 | 2025-09-12 | 2025-09-15 | AP-WNK-102 | 2025-09-04 | — | 2025-09-05 | 2025-09-08 | 2025-09-11 | — | 2025-09-12 | 2025-09-20 | — | — |
| **SC012** | 2025-09-07 | Marketing - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-16 | 2025-09-18 | AP-WNK-103 | 2025-09-07 | 2025-09-08 | 2025-09-09 | 2025-09-12 | 2025-09-15 | — | 2025-09-16 | 2025-09-26 | — | — |
| **SC013** | 2025-09-10 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Estándar | CCC-COM-009 | 2025-09-17 | 2025-09-19 | AP-WNK-104 | 2025-09-10 | — | 2025-09-11 | 2025-09-14 | 2025-09-16 | — | 2025-09-17 | 2025-09-28 | — | — |
| **SC014** | 2025-09-12 | Ventas - Wanka's | Diana Huamán Ríos | Implementado | Cambio Mayor | CCC-COM-009 | 2025-09-19 | 2025-09-21 | AP-WNK-105 | 2025-09-12 | — | 2025-09-13 | 2025-09-15 | 2025-09-18 | — | 2025-09-19 | 2025-09-30 | — | — |
