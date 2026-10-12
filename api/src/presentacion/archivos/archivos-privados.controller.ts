import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { carpetaPrivada, verificarEnlace } from '../../infraestructura/seguridad/archivos-privados';

const TIPOS: Record<string, string> = { webp: 'image/webp', pdf: 'application/pdf' };

/**
 * Entrega de archivos privados (comprobantes de pago) con enlace firmado y temporal.
 *
 * No pide sesión a propósito: el enlace ya trae la prueba de que la API lo firmó hace menos de 30
 * minutos para alguien que tenía derecho a verlo, y así sirve en `<img>` y en enlaces normales.
 * Ver infraestructura/seguridad/archivos-privados.ts.
 */
@Controller('archivos-privados')
export class ArchivosPrivadosController {
  @Get(':carpeta/:nombre')
  async servir(
    @Param('carpeta') carpeta: string,
    @Param('nombre') nombre: string,
    @Query('vence') vence: string | undefined,
    @Query('firma') firma: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // Mismo mensaje para "firma mala" y "vencido": no se le explica nada a quien prueba enlaces.
    if (verificarEnlace(carpeta, nombre, vence, firma) !== 'valido') {
      throw new ForbiddenException('El enlace no es válido o venció.');
    }
    const ruta = join(carpetaPrivada(), carpeta, nombre);
    try {
      await access(ruta);
    } catch {
      throw new NotFoundException('El archivo ya no existe.');
    }
    res.setHeader('Content-Type', TIPOS[nombre.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    // Que ningún intermediario ni el navegador lo guarde: el enlace vence, el archivo no debería sobrevivirle.
    res.setHeader('Cache-Control', 'private, no-store');
    // La política de contenido general de la API (default-src 'none') impide que el visor de PDF del
    // navegador funcione. Aquí es seguro quitarla: solo se sirven imágenes re-codificadas por nosotros y
    // PDF verificados, siempre con tipo fijo y X-Content-Type-Options: nosniff.
    res.removeHeader('Content-Security-Policy');
    res.sendFile(ruta);
  }
}
