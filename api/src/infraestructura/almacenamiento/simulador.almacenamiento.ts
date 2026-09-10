import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AlmacenamientoArchivos,
  ArchivoSubido,
} from '../../dominio/auth/auth.ports';

/**
 * Almacenamiento simulado -- mismo criterio que simulador.pasarela.ts y
 * SimuladorNotificador: guarda el archivo REAL en disco local (no lo
 * inventa ni lo descarta), en vez de subirlo a Cloudinary/S3. Se
 * reemplaza por la integracion real al final, sin tocar nada mas del
 * sistema.
 *
 * NOTA IMPORTANTE, sin ocultarla: para que la URL devuelta sea
 * visitable de verdad en un navegador, falta configurar en main.ts que
 * el servidor sirva esta carpeta como archivos estaticos
 * (app.useStaticAssets o similar). Ese es el paso inmediato siguiente
 * a este.
 */
@Injectable()
export class SimuladorAlmacenamiento implements AlmacenamientoArchivos {
  private readonly logger = new Logger(SimuladorAlmacenamiento.name);
  private readonly carpetaBase = join(process.cwd(), 'uploads');

  async guardarImagen(
    buffer: Buffer,
    nombreOriginal: string,
    carpeta: string,
  ): Promise<ArchivoSubido> {
    const carpetaDestino = join(this.carpetaBase, carpeta);
    await mkdir(carpetaDestino, { recursive: true });

    const extension = nombreOriginal.split('.').pop() || 'jpg';
    const nombreArchivo = `${randomUUID()}.${extension}`;
    const rutaCompleta = join(carpetaDestino, nombreArchivo);

    await writeFile(rutaCompleta, buffer);

    const url = `/uploads/${carpeta}/${nombreArchivo}`;
    this.logger.log(`[SIMULADO] Archivo guardado en disco -> ${rutaCompleta}, URL: ${url}`);

    return { url, nombreArchivo };
  }
}
