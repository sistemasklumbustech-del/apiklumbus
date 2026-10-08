import { createHmac } from 'node:crypto';
import { firmarWebhook, generarSecretoWebhook, verificarFirmaWebhook } from './firma-webhook';

describe('firma de webhooks', () => {
  const secreto = 'whsec_secreto_de_prueba';
  const cuerpo = '{"evento":"venta_creada","compraId":"abc"}';
  const ts = 1_790_000_000;

  it('firma con HMAC-SHA256 sobre "timestamp.cuerpo", con prefijo v1=', () => {
    const esperado = createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex');
    expect(firmarWebhook(secreto, ts, cuerpo)).toBe(`v1=${esperado}`);
  });

  it('vector de referencia fijo, para que el equipo de una cooperativa pueda comprobar su implementación', () => {
    expect(firmarWebhook('whsec_ejemplo', 1790000000, '{"a":1}')).toBe(
      'v1=74065b7f65fa8594a7c5e3ccf619764d0c71b6f160376a89d8390bd144a637a0',
    );
  });

  it('acepta una firma correcta dentro de la tolerancia', () => {
    const firma = firmarWebhook(secreto, ts, cuerpo);
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts), firma }, cuerpo, { ahoraSegundos: ts + 60 })).toBe('valida');
  });

  it('rechaza un cuerpo modificado, otro secreto y una firma con otro formato', () => {
    const firma = firmarWebhook(secreto, ts, cuerpo);
    const opciones = { ahoraSegundos: ts };
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts), firma }, cuerpo + ' ', opciones)).toBe('firma_invalida');
    expect(verificarFirmaWebhook('whsec_otro', { timestamp: String(ts), firma }, cuerpo, opciones)).toBe('firma_invalida');
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts), firma: 'v1=abc' }, cuerpo, opciones)).toBe('firma_invalida');
    expect(verificarFirmaWebhook(secreto, { timestamp: 'no-es-numero', firma }, cuerpo, opciones)).toBe('firma_invalida');
  });

  it('rechaza un envío viejo reutilizado (replay), aunque la firma sea correcta', () => {
    const firma = firmarWebhook(secreto, ts, cuerpo);
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts), firma }, cuerpo, { ahoraSegundos: ts + 301 })).toBe(
      'timestamp_fuera_de_rango',
    );
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts), firma }, cuerpo, { ahoraSegundos: ts - 301 })).toBe(
      'timestamp_fuera_de_rango',
    );
  });

  it('avisa si faltan cabeceras', () => {
    expect(verificarFirmaWebhook(secreto, {}, cuerpo)).toBe('cabeceras_faltantes');
    expect(verificarFirmaWebhook(secreto, { timestamp: String(ts) }, cuerpo)).toBe('cabeceras_faltantes');
  });

  it('los secretos generados tienen prefijo y son distintos cada vez', () => {
    const a = generarSecretoWebhook();
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(generarSecretoWebhook()).not.toBe(a);
  });
});
