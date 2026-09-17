import { Controller, Get } from '@nestjs/common';
import { TerminosService } from '../../aplicacion/terminos/terminos.service';

/** Público, sin login -- lo usa la página /terminos y los formularios de registro/checkout para saber qué versión mostrar y aceptar. */
@Controller('terminos')
export class TerminosController {
  constructor(private readonly terminos: TerminosService) {}

  @Get('vigente')
  async vigente() {
    return this.terminos.obtenerVigente();
  }
}
