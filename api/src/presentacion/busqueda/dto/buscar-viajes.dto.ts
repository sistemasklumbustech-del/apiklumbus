import { IsUUID, IsDateString, IsOptional, IsInt, Min, Matches, IsString } from 'class-validator';
import { Type as TransformType } from 'class-transformer';

export class BuscarViajesDto {
  @IsUUID()
  origenId!: string;

  @IsUUID()
  destinoId!: string;

  /** Formato YYYY-MM-DD. */
  @IsDateString()
  fecha!: string;

  @IsOptional()
  @TransformType(() => Number)
  @IsInt()
  @Min(1)
  pasajeros?: number = 1;

  /**
   * Ítem 11, Fase 2 (04-ago-2026) -- filtros de búsqueda. Rango de hora
   * de salida, formato "HH:MM" 24h, hora local Ecuador. Ambos opcionales
   * pero deben venir juntos (el service los usa como par).
   */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaDesde debe tener formato HH:MM' })
  horaDesde?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'horaHasta debe tener formato HH:MM' })
  horaHasta?: string;

  @IsOptional()
  @IsUUID()
  tipoVehiculoId?: string;

  /**
   * Lista de amenidades separadas por coma en el query string (ej.
   * "wifi,tv") -- un GET no tiene un formato nativo de array limpio,
   * y el service la separa. AND, no OR: si el pasajero marca WiFi y
   * TV, solo ve viajes que tengan AMBAS, no cualquiera de las dos --
   * mismo comportamiento esperado de una lista de checkboxes que
   * angosta resultados.
   */
  @IsOptional()
  @IsString()
  amenidades?: string;
}
