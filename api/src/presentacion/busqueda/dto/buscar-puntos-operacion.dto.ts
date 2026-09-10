import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class BuscarPuntosOperacionDto {
  @IsString()
  @MinLength(2, { message: 'Escribe al menos 2 caracteres para buscar.' })
  texto!: string;

  /**
   * Bug real encontrado (26-ago-2026, auditoría real del director,
   * probando el flujo completo de una cooperativa nueva creando su
   * primer entorno): este mismo endpoint lo usa tanto el buscador
   * público del pasajero (donde SÍ tiene sentido exigir que el punto
   * ya tenga una ruta real -- no mostrar ciudades sin viajes) como el
   * selector de Origen/Destino al crear una ruta en el panel de
   * cooperativa (donde NO debe exigirse -- ahí el objetivo es
   * justamente crear la primera). Sin este parámetro, una cooperativa
   * nueva nunca podía encontrar ni seleccionar un punto para su
   * primera ruta -- ni siquiera uno recién aprobado por el admin,
   * porque recién aprobado todavía tiene 0 rutas reales. Candado
   * circular real, sin ninguna forma de romperlo antes de este fix.
   * Por defecto `true` -- preserva el comportamiento público ya
   * verificado, sin afectarlo.
   */
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  soloConRutas?: boolean = true;
}
