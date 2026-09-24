import { BadRequestException, Injectable } from '@nestjs/common';
import { PanelEmpresaService } from './panel-empresa.service';
import { CargaMasivaCatalogo } from '../../infraestructura/panelempresa/carga-masiva.catalogo';
import {
  analizarPlantilla,
  generarPlantilla,
} from '../../infraestructura/panelempresa/carga-masiva.excel';

/** Carga masiva por plantilla Excel: descargar, revisar (sin guardar) e importar. */
@Injectable()
export class CargaMasivaService {
  constructor(
    private readonly catalogo: CargaMasivaCatalogo,
    private readonly panel: PanelEmpresaService,
  ) {}

  async plantilla(): Promise<Buffer> {
    return generarPlantilla(await this.catalogo.puntos());
  }

  /** Revisa el archivo y dice qué se crearía y qué filas tienen errores. No guarda nada. */
  async revisar(cooperativaId: string, archivo: Buffer) {
    const analisis = await analizarPlantilla(
      archivo,
      await this.catalogo.deCooperativa(cooperativaId),
    );
    return {
      ok: analisis.errores.length === 0,
      errores: analisis.errores,
      resumen: analisis.resumen,
    };
  }

  /** Vuelve a revisar el archivo y, solo si no tiene errores, lo importa todo en una transacción. */
  async importar(cooperativaId: string, archivo: Buffer) {
    const analisis = await analizarPlantilla(
      archivo,
      await this.catalogo.deCooperativa(cooperativaId),
    );
    if (analisis.errores.length > 0) {
      throw new BadRequestException({
        message:
          'El archivo tiene errores: corrígelos y vuelve a subirlo. No se guardó nada.',
        errores: analisis.errores,
      });
    }
    return this.panel.importarDatos(cooperativaId, analisis.datos);
  }
}
