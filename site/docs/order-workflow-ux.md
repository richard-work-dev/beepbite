# Pedidos: UX y responsables

## Investigación y adaptación

Documentación primaria consultada el 3 de octubre de 2026:

- [Square Order Manager](https://squareup.com/help/us/en/article/6923-pickup-orders-on-square-point-of-sale): bandeja por tarea/modalidad, detalle e historial; entrega y pago visibles por separado.
- [Toast Orders Hub](https://support.toasttab.com/en/article/Orders-Hub-Status-Breakdown): distinguir preparación, listo y completado; cobro desde el detalle.
- [Toast: expediter](https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html): consolidar comandas no equivale a servir al cliente; separar cocina y atención.
- [NN/g: progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): primero la próxima tarea; comprobantes e historial bajo demanda.

La adaptación a BeepBite es una decisión de diseño, no una garantía de conversión.

## Responsabilidades

| Paso | Responsable | Regla |
| --- | --- | --- |
| Recibir | Caja / POS | Revisar y aceptar si está pendiente. Los pedidos web actualmente ingresan aceptados y enrutados a cocina. |
| Preparar | Cocina | Iniciar y marcar listo en comandas. Listo cuando las estaciones terminaron. |
| Retirar | Mostrador / POS | Registrar pago y confirmar entrega real al cliente. |
| Servir en mesa | Salón con acceso POS | Confirmar llegada de la comida a la mesa. Se permite pagar después. |
| Despachar delivery | Repartidor asignado | Aceptar asignación y retirar solo cuando esté listo; transferencia pendiente bloquea despacho. |
| Entregar delivery | Repartidor asignado | Confirmar después del retiro; entregar no marca pagado. |
| Delivery sin asignación | Caja / despacho | Registrar retiro/entrega manualmente tras comprobar el hecho. Si existe asignación activa, no puede sustituir al repartidor. |
| Cobrar | Caja con permiso de cobro | Registrar dinero recibido o transferencia verificada. No se procesa ni comprueba el pago bancario automáticamente. |
| Asignar, anular, devolver | Encargado / administrador | Acciones específicas, no cambios por la API genérica. |

`staff` y `pos` conservan los mismos permisos operativos predeterminados. No se migraron usuarios reales. `can_settle: false` restringe el cobro; miembros POS anteriores sin esa clave mantienen su acceso. Cocina no tiene permisos de caja. Un PIN activo usa los permisos/local del empleado y no hereda los del propietario de la sesión base.

## Estados separados

- Preparación: `pending → confirmed → preparing → ready`. Cocina puede marcar listo directamente para preparación inmediata.
- Retiro / mesa: `ready → completed`, donde `completed` significa retirado o servido, no pagado.
- Delivery: `ready → out_for_delivery → delivered`.
- Pago: pendiente / parcial / pagado, independientemente de entrega.
- Entregados sin cobrar siguen en “Cobrar” y “En curso”, no se esconden en historial.
- Pagar o terminar una comanda nunca confirma retiro, servicio ni entrega.
- Un pago anticipado no libera automáticamente la mesa si todavía hay pedidos sin servir.
- `pending_on_delivery` antiguo exige confirmación de entrega explícita; pagar no presume entrega.
- No se reescriben estados históricos: no hay evidencia para reconstruir entregas cerradas automáticamente antes.

## Interacción y límites

“En curso” prioriza recepción, listos y entregados pendientes de cobro, por antigüedad dentro de cada prioridad. Filtros visibles, modalidad y búsqueda. Una tarjeta abre productos, instrucciones, saldo y próxima responsabilidad. Cobro y entrega son pasos distintos dentro del mismo detalle. El historial expandible muestra identidad, rol y hora de las nuevas transiciones.

Teléfono: una columna y filtros sin desplazamiento horizontal. Tablet: dos columnas. Laptop: tres. El detalle tiene cuerpo desplazable y pie fijo; importes según moneda del local. Bandeja: hasta 250 operativos, 250 entregados sin cobrar y 100 históricos. Avisa si quedan más pendientes; no reemplaza auditoría histórica ilimitada.

En teléfonos se priorizan “En curso” y “Nuevo pedido”; venta rápida y mesas están en “Más vistas”. Se omiten indicadores duplicados para mostrar la identificación del primer pedido por encima de la barra inferior incluso a 320 × 568 px. La navegación principal identifica TPV o Cocina según el área abierta.

## Seguridad y validación

Permisos y actor PIN verificados en servidor. Las transiciones comparan estado revisado y documento previo en DynamoDB. Pago y saldo se escriben juntos en una transacción condicional; identidad del cobrador tomada de la sesión. El repartidor opera únicamente sus asignaciones; pedido/asignación avanzan juntos.

Las pruebas de navegador interceptan las APIs y no crean pedidos, pagos ni usuarios reales. Cubren transferencia → retiro, servir → cobro pendiente, repartidor asignado, rol sin cobro y pantallas de 320 a 1366 px. Go valida permisos, actor PIN, auditoría y escritura conjunta con el SDK de DynamoDB usando un transporte HTTP en memoria.

Antes de ampliar el rediseño, observar un turno real: tiempo hasta enviar comanda, errores de modalidad, entregas sin cobrar y cambios de pantalla. Las pruebas automáticas detectan regresiones, pero no reemplazan una prueba de uso con caja y cocina.
