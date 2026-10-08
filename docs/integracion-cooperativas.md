# Integración de cooperativas con Klumbus

Guía para el equipo técnico de una cooperativa que ya tiene su propio sistema
(venta en ventanilla, facturación electrónica y conexión con el SIAT 3000) y
quiere vender sus pasajes en línea por Klumbus. Klumbus define este contrato;
cada cooperativa lo adapta a su sistema.

Última revisión: 7 de octubre de 2026.

## Qué hace cada parte

| Tarea | Quién |
|---|---|
| Publicar viajes y horarios en Klumbus | La cooperativa, por esta API |
| Vender en línea y cobrar al pasajero | Klumbus |
| Avisar de cada venta a la cooperativa | Klumbus, por webhook |
| Facturar el pasaje y registrar la tasa en el SIAT 3000 | La cooperativa, con su sistema |
| Reportar la factura y el código de tasa de cada venta | La cooperativa, por esta API |
| Reportar los asientos que vende en ventanilla | La cooperativa, por esta API |
| Liquidar a la cooperativa lo cobrado | Klumbus |

Klumbus no factura el pasaje ni opera el saldo del SIAT 3000 de la cooperativa
en este modo. Eso lo hace el sistema de la cooperativa.

## Autenticación

Cada cooperativa genera sus llaves desde su panel (Credenciales API). La llave
completa se muestra una sola vez.

```
Authorization: Bearer tkya_live_<identificador>.<secreto>
```

Una llave inválida o revocada devuelve `401`. Cada llave solo ve y modifica los
datos de su propia cooperativa.

## Flujo de una venta en línea

1. El pasajero compra en Klumbus. Klumbus cobra.
2. Klumbus envía el webhook `venta_creada` a la URL de la cooperativa.
3. El sistema de la cooperativa emite la factura y registra la tasa en el SIAT
   3000, usando los datos del webhook.
4. El sistema de la cooperativa reporta el resultado a Klumbus con
   `POST /api-externa/compras/{compraId}/confirmacion`.
5. Klumbus guarda la factura y el código de tasa, y marca la compra como
   completada.

Si la cooperativa no reporta en **30 minutos**, la venta pasa a revisión manual
del equipo de Klumbus. Un reporte tardío se acepta igual.

## Webhook `venta_creada`

Klumbus envía un `POST` con `Content-Type: application/json` a la URL
configurada en la llave. Debe responder con cualquier código `2xx`. Si no,
Klumbus reintenta cada 5 minutos, hasta 5 intentos.

```json
{
  "evento": "venta_creada",
  "compraId": "0c7a5f1e-2b1d-4c1a-9a55-6f0f3a3b9d11",
  "boletos": [
    {
      "id": "…",
      "codigoQr": "…",
      "numeroAsiento": "1B",
      "precioPagado": 8.5,
      "tasaTerminal": 0.5,
      "cooperativaNombre": "Coop de ejemplo",
      "rutaOrigenCiudad": "Machala",
      "rutaDestinoCiudad": "Guayaquil",
      "fechaSalida": "2026-12-05",
      "horaSalidaProgramada": "2026-12-05T13:00:00.000Z"
    }
  ],
  "venta": {
    "cliente": {
      "tipoIdentificacion": "cedula",
      "identificacion": "1701001370",
      "razonSocial": "Ana Prueba",
      "correo": "ana@correo.com",
      "direccion": null
    },
    "pasajeros": [
      {
        "asientoEtiqueta": "1B",
        "viajeId": "…",
        "tipoTarifa": "adulto",
        "precioPagado": 8.5,
        "tasaTerminal": 0.5
      }
    ],
    "totalAFacturar": 9
  }
}
```

- `venta.cliente` es a quien se factura. `tipoIdentificacion` es `cedula`,
  `ruc` o `pasaporte`. Si el comprador no indicó datos de facturación, se usan
  los del primer pasajero.
- `tipoTarifa` es `adulto`, `nino`, `tercera_edad` o `discapacidad`.
- `totalAFacturar` es la suma de pasaje y tasa de terminal de esta cooperativa
  en la compra. El cargo de servicio de Klumbus no va en esa factura.
- La compra puede incluir boletos de otras cooperativas: cada cooperativa recibe
  solo los suyos.
- El mismo evento puede llegar más de una vez. Use `compraId` para no procesarlo
  dos veces.

Para verificar qué se entregó, consulte `GET /api-externa/webhooks`
(parámetros opcionales `desde` y `hasta`).

## Confirmar una venta

```
POST /api-externa/compras/{compraId}/confirmacion
```

```json
{
  "numeroFactura": "000000789",
  "claveAcceso": "1234567890123456789012345678901234567890123456789",
  "numeroAutorizacion": "1234567890123456789012345678901234567890123456789",
  "urlFactura": "https://sistema-coop.example/facturas/000000789.pdf",
  "codigoTasa": "12345678901234567890"
}
```

| Campo | Obligatorio | Formato |
|---|---|---|
| `numeroFactura` | Sí | 9 dígitos (el secuencial enviado al SIAT 3000) |
| `codigoTasa` | Sí | 20 dígitos (es el contenido del QR del torniquete) |
| `claveAcceso` | No | 49 dígitos |
| `numeroAutorizacion` | No | hasta 49 caracteres |
| `urlFactura` | No | enlace al PDF o RIDE |

Respuestas: `201` si se aceptó (también al repetirla, es idempotente), `400` si
un campo no cumple el formato, `404` si esa compra no tiene nada pendiente para
su cooperativa.

## Catálogo

```
GET /api-externa/catalogo
```

Devuelve las rutas y unidades de la cooperativa con los identificadores de
Klumbus (`id`), para que su sistema los relacione con los suyos. Las rutas y las
unidades se crean desde el panel de la cooperativa.

## Viajes

```
PUT /api-externa/viajes/{referencia}
```

`referencia` es el identificador del viaje en SU sistema (1 a 100 caracteres).
Crea el viaje si no existe y lo actualiza si ya existe, así que enviarlo dos
veces no duplica nada.

```json
{
  "rutaId": "…",
  "unidadId": "…",
  "horaSalidaProgramada": "2026-12-05T08:00:00-05:00",
  "horaLlegadaEstimada": "2026-12-05T12:30:00-05:00",
  "precioBase": 12.5,
  "recargoVip": 2
}
```

- `horaSalidaProgramada` va en ISO 8601 con zona horaria. La fecha de salida se
  calcula en hora de Ecuador.
- `recargoVip` es opcional; si falta se usa el de la cooperativa.
- Respuesta `200`: `{ "id": "…", "creado": true }`.
- `400` con `codigo` `ruta_invalida` o `unidad_invalida` si no son de su
  cooperativa o están inactivas.
- `409` con `codigo` `viaje_con_ventas` si ya hay asientos tomados y intenta
  cambiar la ruta, la unidad o la hora (el precio sí se puede cambiar), o
  `viaje_no_programado` si el viaje ya salió o se canceló.

Además existen `PATCH /api-externa/viajes/{id}/precio` y
`PATCH /api-externa/viajes/{id}/ubicacion` (latitud y longitud) para actualizar
el precio y la posición del bus.

## Asientos

Un asiento puede estar libre o en uno de estos estados:

| Estado | Significado |
|---|---|
| `vendido_klumbus` | Lo compró un pasajero en Klumbus |
| `pago_en_revision` | Un pasajero pagó por un medio manual y se espera confirmación |
| `en_compra` | Un pasajero lo tiene bloqueado mientras paga (unos minutos) |
| `ocupado_cooperativa` | La cooperativa lo reportó como vendido en ventanilla |

### Ver el estado

```
GET /api-externa/viajes/{id}/asientos
```

Devuelve `numerosValidos` (la numeración de la unidad) y la lista
`noDisponibles` con `numero`, `estado`, `referencia` y `expiraEn`. Todo asiento
que no aparece está libre.

### Reportar asientos vendidos en ventanilla

```
POST /api-externa/viajes/{id}/asientos/ocupados
```

```json
{ "asientos": [ { "numero": "1A", "referencia": "TKT-001" }, { "numero": "1B" } ] }
```

Cada asiento se resuelve por separado. El resultado trae `resultados` y el
número de `conflictos`:

| `resultado` | Qué pasó |
|---|---|
| `ocupado` | Quedó ocupado |
| `ya_ocupado` | Ya lo había reportado (se actualiza la referencia) |
| `inexistente` | El número no existe en la unidad |
| `conflicto` | No se pudo ocupar; ver `motivo` |

Motivos de conflicto: `vendido_en_klumbus`, `pago_en_revision`,
`en_proceso_de_compra` (con `expiraEn`: puede reintentar cuando venza). Klumbus
**nunca** quita un asiento a un pasajero que ya pagó o está pagando: en ese caso
el sistema de la cooperativa debe resolverlo, por ejemplo reubicando a su cliente
y reintentando.

### Liberar asientos

```
POST /api-externa/viajes/{id}/asientos/liberar
```

```json
{ "asientos": [ "1A", "1B" ] }
```

Solo libera asientos que la propia cooperativa ocupó. Para uno vendido por
Klumbus devuelve `conflicto` con motivo `no_es_de_la_cooperativa`.

Se aceptan hasta 60 asientos por solicitud.

## Errores comunes

| Código | Causa |
|---|---|
| `401` | Falta la llave o es inválida |
| `400` | Datos inválidos; el mensaje indica el campo |
| `404` | El viaje o la compra no existe para su cooperativa |
| `409` | El viaje ya no admite ese cambio |

## Lo que todavía no incluye

- **Firma del webhook.** Hoy el webhook no lleva firma, así que su sistema no
  puede comprobar que lo envía Klumbus. Está pendiente. Mientras tanto,
  verifique el `compraId` consultando la confirmación.
- **Pago a cargo de la cooperativa.** En este modo Klumbus cobra y liquida.
- **Cancelar un viaje por API.** Se hace desde el panel de la cooperativa.
- **Ambiente de pruebas separado.** Las pruebas se coordinan con el equipo de
  Klumbus, que habilita viajes de prueba ocultos al público.
