import { BadRequestException } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SimuladorAlmacenamiento } from './simulador.almacenamiento';

describe('almacenamiento de archivos subidos', () => {
  const carpeta = `prueba-${Date.now()}`;
  afterAll(async () => {
    await rm(join(process.cwd(), 'uploads', carpeta), { recursive: true, force: true });
  });

  it('guarda un PDF de verdad', async () => {
    const almacen = new SimuladorAlmacenamiento();
    const { nombreArchivo } = await almacen.guardarImagen(Buffer.from('%PDF-1.4\n%contenido'), 'comprobante.pdf', carpeta);
    expect(nombreArchivo.endsWith('.pdf')).toBe(true);
  });

  it('rechaza algo que se llama .pdf pero no lo es', async () => {
    const almacen = new SimuladorAlmacenamiento();
    for (const contenido of ['<html><script>alert(1)</script></html>', 'MZ\u0090\u0000ejecutable', '']) {
      await expect(almacen.guardarImagen(Buffer.from(contenido), 'factura.pdf', carpeta)).rejects.toThrow(BadRequestException);
    }
  });

  it('rechaza una imagen que no se puede decodificar', async () => {
    const almacen = new SimuladorAlmacenamiento();
    await expect(almacen.guardarImagen(Buffer.from('no soy una imagen'), 'foto.png', carpeta)).rejects.toThrow(BadRequestException);
  });
});
