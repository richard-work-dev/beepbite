# Pedido nativo dentro de WhatsApp

El backend soporta un WhatsApp Flow publicado en Meta como acelerador del pedido. El cliente escribe `pedir` (o elige “nuevo pedido”), recibe el formulario dentro de WhatsApp y, al enviarlo, el webhook recibe `nfm_reply`/`flow_reply`.

## Configuración

Definí estas variables:

```env
WHATSAPP_ORDER_FLOW_ID=<id-del-flow-publicado>
WHATSAPP_ORDER_FLOW_SCREEN=ORDER
WHATSAPP_ORDER_FLOW_CTA=Hacer pedido
```

El Flow debe devolver en `response_json` una estructura equivalente a:

```json
{
  "screen": "SUCCESS",
  "data": {
    "location_id": "uuid-del-local",
    "order_type": "pickup",
    "items": [
      { "item_id": "uuid-del-producto", "quantity": 2, "special_instructions": "sin cebolla" }
    ]
  }
}
```

Para delivery, `data` debe incluir `address` o coordenadas `latitude`/`longitude`; opcionalmente `instructions` y `email`.

El servidor valida que el local y cada producto estén activos y pertenezcan al mismo local. Luego limpia el carrito abandonado, carga los productos y usa el mismo creador de pedidos del chatbot. Por eso el pedido conserva moneda, impuestos, precios y entrada al flujo de cocina.

Sin `WHATSAPP_ORDER_FLOW_ID`, el flujo de texto existente sigue funcionando. Si Meta rechaza el Flow, el cliente recibe una instrucción para continuar por chat.

## Diseño recomendado del Flow

Usá una primera pantalla de local y modalidad, una pantalla de productos con cantidad, una pantalla opcional de dirección para delivery y una pantalla de revisión/confirmación. El botón final debe devolver el payload anterior; no envíes precios desde el teléfono como fuente de verdad: el backend los vuelve a resolver desde el catálogo.
