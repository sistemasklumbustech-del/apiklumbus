import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AlmacenamientoArchivos,
  ArchivoSubido,
} from '../../dominio/auth/auth.ports';

// Mismo patron que URL_FRONTEND en resend.notificador.ts -- hardcodeado
// a proposito, no via env, siguiendo la convencion ya establecida en
// este proyecto para URLs publicas conocidas.
const URL_API_PUBLICA = 'https://api.klumbus.tech';

/**
 * Almacenamiento simulado -- mismo criterio que simulador.pasarela.ts y
 * SimuladorNotificador: guarda el archivo REAL en disco local (no lo
 * inventa ni lo descarta), en vez de subirlo a Cloudinary/S3. Se
 * reemplaza por la integracion real al final, sin tocar nada mas del
 * sistema.
 *
 * app.useStaticAssets ya esta configurado en main.ts (sirve esta
 * carpeta bajo /uploads) -- eso hace que la URL sea visitable de
 * verdad. Hallazgo real (22-sep-2026, comprobante de ventanilla
 * probado por el director): faltaba el otro lado del problema -- esta
 * URL se devolvia RELATIVA ("/uploads/..."), y el navegador la resolvia
 * contra el origen de la pagina que la muestra (klumbustech.com, el
 * frontend), no contra la API que de verdad sirve el archivo -> 404.
 * Se antepone el origen de la API para que la URL sea absoluta y
 * funcione sin importar desde donde se muestre.
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

    const url = `${URL_API_PUBLICA}/uploads/${carpeta}/${nombreArchivo}`;
    this.logger.log(`[SIMULADO] Archivo guardado en disco -> ${rutaCompleta}, URL: ${url}`);

    return { url, nombreArchivo };
  }
}
