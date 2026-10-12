import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AlmacenamientoArchivos,
  ArchivoPrivadoSubido,
  ArchivoSubido,
} from '../../dominio/auth/auth.ports';
import { CARPETAS_PRIVADAS, carpetaPrivada, crearReferencia } from '../seguridad/archivos-privados';

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
/**
 * Tamaño máximo (en píxeles, lado más largo) según lo que se sube: un
 * logo o una foto de perfil se ven pequeños, así que no tiene sentido
 * guardarlos grandes; un banner o un comprobante necesitan más detalle.
 * Lo que no esté en la lista usa el valor por defecto.
 */
const LADO_MAXIMO_POR_CARPETA: Record<string, number> = {
  perfiles: 600,
  logos: 800,
  banners: 1920,
};
const LADO_MAXIMO_POR_DEFECTO = 1600;
const CALIDAD_WEBP = 80;

/**
 * Único punto por donde pasa TODO lo que se sube a la aplicación (foto de
 * perfil, logo de cooperativa, banners, comprobantes de pago): las
 * imágenes se corrigen de orientación, se reducen al tamaño útil, se
 * les quita el metadata (ubicación GPS, cámara) y se guardan como WebP.
 * Una foto de celular de 4-8 MB queda en unos 100-300 KB. Los PDF
 * (comprobantes) se guardan tal cual.
 */
@Injectable()
export class SimuladorAlmacenamiento implements AlmacenamientoArchivos {
  private readonly logger = new Logger(SimuladorAlmacenamiento.name);
  private readonly carpetaBase = join(process.cwd(), 'uploads');

  /** Valida el archivo y lo deja listo para guardar: imagen reducida a WebP sin metadatos, o PDF verificado. */
  private async procesar(
    buffer: Buffer,
    nombreOriginal: string,
    carpeta: string,
  ): Promise<{ contenido: Buffer; extension: 'webp' | 'pdf' }> {
    const extensionOriginal = (
      nombreOriginal.split('.').pop() || ''
    ).toLowerCase();
    let contenido = buffer;
    let extension: 'webp' | 'pdf' = 'webp';
    if (extensionOriginal === 'pdf') {
      // Un PDF se guarda tal cual, así que se comprueba que de verdad lo sea: no basta con que el
      // nombre termine en ".pdf" (podría ser una página HTML o un script).
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new BadRequestException('El archivo no es un PDF válido.');
      }
      extension = 'pdf';
    } else {
      try {
        contenido = await sharp(buffer)
          .rotate()
          .resize({
            width: LADO_MAXIMO_POR_CARPETA[carpeta] ?? LADO_MAXIMO_POR_DEFECTO,
            height: LADO_MAXIMO_POR_CARPETA[carpeta] ?? LADO_MAXIMO_POR_DEFECTO,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: CALIDAD_WEBP })
          .toBuffer();
        this.logger.log(
          `Imagen optimizada (${carpeta}): ${Math.round(buffer.length / 1024)} KB -> ${Math.round(contenido.length / 1024)} KB`,
        );
      } catch {
        throw new BadRequestException(
          'El archivo no es una imagen válida. Usa una foto JPG, PNG o WEBP.',
        );
      }
    }
    return { contenido, extension };
  }

  /** Archivos públicos (fotos de perfil, logos, banners): se sirven desde /uploads. */
  async guardarImagen(
    buffer: Buffer,
    nombreOriginal: string,
    carpeta: string,
  ): Promise<ArchivoSubido> {
    const { contenido, extension } = await this.procesar(buffer, nombreOriginal, carpeta);
    const carpetaDestino = join(this.carpetaBase, carpeta);
    await mkdir(carpetaDestino, { recursive: true });
    const nombreArchivo = `${randomUUID()}.${extension}`;
    const rutaCompleta = join(carpetaDestino, nombreArchivo);

    await writeFile(rutaCompleta, contenido);

    const url = `${URL_API_PUBLICA}/uploads/${carpeta}/${nombreArchivo}`;
    this.logger.log(`[SIMULADO] Archivo guardado en disco -> ${rutaCompleta}, URL: ${url}`);

    return { url, nombreArchivo };
  }

  /**
   * Archivos con datos de personas (comprobantes de pago): se guardan FUERA de la carpeta pública
   * y se devuelve una referencia, no una URL. Ver infraestructura/seguridad/archivos-privados.ts.
   */
  async guardarPrivado(
    buffer: Buffer,
    nombreOriginal: string,
    carpeta: (typeof CARPETAS_PRIVADAS)[number],
  ): Promise<ArchivoPrivadoSubido> {
    if (!(CARPETAS_PRIVADAS as readonly string[]).includes(carpeta)) {
      throw new Error(`"${carpeta}" no es una carpeta privada.`);
    }
    const { contenido, extension } = await this.procesar(buffer, nombreOriginal, carpeta);
    const carpetaDestino = join(carpetaPrivada(), carpeta);
    await mkdir(carpetaDestino, { recursive: true });
    const nombreArchivo = `${randomUUID()}.${extension}`;
    await writeFile(join(carpetaDestino, nombreArchivo), contenido);
    this.logger.log(`Archivo privado guardado (${carpeta}): ${nombreArchivo}`);
    return { referencia: crearReferencia(carpeta, nombreArchivo), nombreArchivo };
  }
}
