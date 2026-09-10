CREATE TYPE "public"."accion_auditoria" AS ENUM('aprobacion_cooperativa', 'baja_cooperativa', 'cambio_comision', 'aprobacion_campana', 'ajuste_liquidacion');--> statement-breakpoint
CREATE TYPE "public"."canal_notificacion" AS ENUM('correo', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."canal_venta" AS ENUM('en_linea', 'ventanilla');--> statement-breakpoint
CREATE TYPE "public"."estado_asiento" AS ENUM('disponible', 'bloqueado_temporal', 'ocupado');--> statement-breakpoint
CREATE TYPE "public"."estado_boleto" AS ENUM('vigente', 'usado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."estado_campana" AS ENUM('pendiente_revision', 'aprobada', 'rechazada', 'activa', 'vencida');--> statement-breakpoint
CREATE TYPE "public"."estado_comprobante" AS ENUM('pendiente_autorizacion', 'autorizado', 'rechazado', 'reintento');--> statement-breakpoint
CREATE TYPE "public"."estado_cooperativa" AS ENUM('pendiente_revision', 'aprobada', 'suspendida', 'dada_de_baja');--> statement-breakpoint
CREATE TYPE "public"."estado_lead" AS ENUM('nuevo', 'contactado', 'cerrado');--> statement-breakpoint
CREATE TYPE "public"."estado_pago" AS ENUM('pendiente', 'aprobado', 'rechazado', 'revertido');--> statement-breakpoint
CREATE TYPE "public"."estado_reserva_api" AS ENUM('confirmada', 'revertida');--> statement-breakpoint
CREATE TYPE "public"."estado_viaje" AS ENUM('programado', 'en_curso', 'finalizado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."formato_creatividad" AS ENUM('imagen_texto', 'imagen_texto_video');--> statement-breakpoint
CREATE TYPE "public"."modelo_integracion" AS ENUM('modelo_a', 'modelo_b');--> statement-breakpoint
CREATE TYPE "public"."plan_comercial" AS ENUM('basico', 'destacado', 'premium');--> statement-breakpoint
CREATE TYPE "public"."rol_usuario" AS ENUM('pasajero', 'vendedor', 'admin_cooperativa', 'admin_plataforma');--> statement-breakpoint
CREATE TYPE "public"."sujeto_tributario" AS ENUM('cooperativa', 'terminal', 'plataforma');--> statement-breakpoint
CREATE TYPE "public"."tipo_acompanamiento_menor" AS ENUM('con_padre_madre_tutor', 'con_autorizacion');--> statement-breakpoint
CREATE TYPE "public"."tipo_notificacion" AS ENUM('confirmacion_compra', 'recordatorio_viaje', 'cambio_operativo');--> statement-breakpoint
CREATE TYPE "public"."tipo_punto_operacion" AS ENUM('terminal_terrestre', 'oficina_agencia', 'parada_intermedia');--> statement-breakpoint
CREATE TYPE "public"."tipo_tarifa" AS ENUM('adulto', 'nino', 'tercera_edad', 'discapacidad');--> statement-breakpoint
CREATE ROLE "ticketya_app";--> statement-breakpoint
CREATE ROLE "ticketya_platform_admin";--> statement-breakpoint
CREATE TABLE "configuracion_plataforma" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruc_plataforma" varchar(13) NOT NULL,
	"razon_social_plataforma" varchar(200) NOT NULL,
	"comision_porcentaje_modelo_a_default" numeric(5, 2),
	"comision_porcentaje_modelo_b_default" numeric(5, 2),
	"cargo_plataforma_por_pasajero_default" numeric(8, 2),
	"ventana_bloqueo_asiento_segundos" integer,
	"politica_cancelacion_notas" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cooperativas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruc" varchar(13) NOT NULL,
	"razon_social" varchar(200) NOT NULL,
	"nombre_comercial" varchar(150) NOT NULL,
	"estado" "estado_cooperativa" DEFAULT 'pendiente_revision' NOT NULL,
	"modelo_integracion" "modelo_integracion" NOT NULL,
	"contacto_nombre" varchar(150),
	"contacto_correo" varchar(200),
	"contacto_telefono" varchar(20),
	"fecha_afiliacion" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "puntos_operacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_punto_operacion" NOT NULL,
	"nombre" varchar(150) NOT NULL,
	"cooperativa_propietaria_id" uuid,
	"ciudad" varchar(100) NOT NULL,
	"provincia" varchar(100) NOT NULL,
	"direccion" text,
	"latitud" double precision,
	"longitud" double precision,
	"tasa_monto" numeric(8, 2),
	"ruc_terminal" varchar(13),
	"liquidacion_banco" varchar(100),
	"liquidacion_numero_cuenta" varchar(50),
	"liquidacion_tipo_cuenta" varchar(20),
	"liquidacion_titular" varchar(150),
	"liquidacion_periodicidad_dias" numeric(3, 0),
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens_usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"proposito" varchar(30) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"usado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rol" "rol_usuario" NOT NULL,
	"cooperativa_id" uuid,
	"correo" varchar(200) NOT NULL,
	"cedula" varchar(20),
	"nombre_completo" varchar(200) NOT NULL,
	"telefono" varchar(20),
	"password_hash" varchar(255),
	"proveedor_externo" varchar(30),
	"proveedor_externo_id" varchar(200),
	"intentos_fallidos" integer DEFAULT 0 NOT NULL,
	"bloqueado_hasta" timestamp with time zone,
	"correo_verificado" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conductores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"nombre_completo" varchar(200) NOT NULL,
	"cedula" varchar(20) NOT NULL,
	"licencia_numero" varchar(30),
	"licencia_categoria" varchar(10),
	"telefono" varchar(20),
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conductores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tipos_vehiculo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"nombre" varchar(100) NOT NULL,
	"capacidad_total" integer NOT NULL,
	"distribucion_asientos" jsonb NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tipos_vehiculo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"tipo_vehiculo_id" uuid NOT NULL,
	"placa" varchar(15) NOT NULL,
	"identificador_operativo" varchar(30) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unidades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "horarios_ruta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruta_id" uuid NOT NULL,
	"hora_salida" time NOT NULL,
	"dias_semana" jsonb NOT NULL,
	"tipo_vehiculo_predeterminado_id" uuid,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ruta_paradas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruta_id" uuid NOT NULL,
	"punto_operacion_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"tarifa_desde_origen" numeric(8, 2) NOT NULL,
	"tiempo_estimado_desde_origen_minutos" integer
);
--> statement-breakpoint
CREATE TABLE "rutas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"nombre" varchar(150),
	"origen_punto_operacion_id" uuid NOT NULL,
	"destino_punto_operacion_id" uuid NOT NULL,
	"precio_base_referencia" numeric(8, 2) NOT NULL,
	"duracion_estimada_minutos" integer,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rutas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "viajes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"ruta_id" uuid NOT NULL,
	"unidad_id" uuid NOT NULL,
	"conductor_id" uuid,
	"horario_ruta_origen_id" uuid,
	"fecha_salida" date NOT NULL,
	"hora_salida_programada" timestamp with time zone NOT NULL,
	"hora_llegada_estimada" timestamp with time zone,
	"precio_base" numeric(8, 2) NOT NULL,
	"estado" "estado_viaje" DEFAULT 'programado' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "viajes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "viaje_asientos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viaje_id" uuid NOT NULL,
	"numero_asiento" varchar(10) NOT NULL,
	"categoria" varchar(30),
	"estado" "estado_asiento" DEFAULT 'disponible' NOT NULL,
	"hold_expira_en" timestamp with time zone,
	"hold_usuario_id" uuid,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "viaje_asientos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "boletos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"compra_id" uuid NOT NULL,
	"pasajero_compra_id" uuid NOT NULL,
	"viaje_asiento_id" uuid NOT NULL,
	"codigo_qr" varchar(100) NOT NULL,
	"precio_pagado" numeric(8, 2) NOT NULL,
	"estado" "estado_boleto" DEFAULT 'vigente' NOT NULL,
	"validado_en" timestamp with time zone,
	"validado_por_usuario_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boletos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comprador_usuario_id" uuid,
	"canal" "canal_venta" NOT NULL,
	"vendedor_usuario_id" uuid,
	"monto_total" numeric(10, 2) NOT NULL,
	"monto_tarifas_cooperativa" numeric(10, 2) NOT NULL,
	"monto_cargo_plataforma" numeric(10, 2) NOT NULL,
	"monto_tasa_terminal" numeric(10, 2) NOT NULL,
	"monto_impuestos" numeric(10, 2) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"proveedor" varchar(30) NOT NULL,
	"referencia_externa" varchar(100),
	"idempotency_key" varchar(100) NOT NULL,
	"monto" numeric(10, 2) NOT NULL,
	"estado" "estado_pago" DEFAULT 'pendiente' NOT NULL,
	"respuesta_proveedor" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pasajeros_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"nombre_completo" varchar(200) NOT NULL,
	"documento" varchar(20) NOT NULL,
	"tipo_tarifa" "tipo_tarifa" NOT NULL,
	"fecha_nacimiento" date,
	"es_menor_edad" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comprobantes_electronicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid,
	"sujeto_tributario" "sujeto_tributario" NOT NULL,
	"cooperativa_id" uuid,
	"ruc_emisor" varchar(13) NOT NULL,
	"monto_comprobante" numeric(10, 2) NOT NULL,
	"clave_acceso" varchar(49),
	"numero_autorizacion" varchar(49),
	"estado" "estado_comprobante" DEFAULT 'pendiente_autorizacion' NOT NULL,
	"ultimo_error_proveedor" text,
	"xml_url" text,
	"pdf_url" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comprobantes_tasa_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boleto_id" uuid NOT NULL,
	"punto_operacion_id" uuid NOT NULL,
	"monto" numeric(8, 2) NOT NULL,
	"codigo_verificacion" varchar(50) NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autorizaciones_menor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pasajero_compra_id" uuid NOT NULL,
	"tipo_acompanamiento" "tipo_acompanamiento_menor" NOT NULL,
	"adulto_acompanante_en_compra_id" uuid,
	"adulto_responsable_nombre" varchar(200),
	"adulto_responsable_documento" varchar(20),
	"adulto_responsable_telefono" varchar(20),
	"documento_autorizacion_url" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verificaciones_menor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boleto_id" uuid NOT NULL,
	"verificado_por_usuario_id" uuid NOT NULL,
	"documento_identidad_verificado" boolean NOT NULL,
	"documento_autorizacion_verificado" boolean NOT NULL,
	"verificado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_notificacion" NOT NULL,
	"canal" "canal_notificacion" NOT NULL,
	"compra_id" uuid,
	"viaje_id" uuid,
	"usuario_destino_id" uuid,
	"correo_destino" varchar(200),
	"telefono_destino" varchar(20),
	"estado_envio" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"enviado_en" timestamp with time zone,
	"error_detalle" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ajustes_liquidacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"liquidacion_cooperativa_id" uuid,
	"liquidacion_terminal_id" uuid,
	"monto" numeric(12, 2) NOT NULL,
	"motivo" text NOT NULL,
	"registrado_por_usuario_id" uuid NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ajustes_liquidacion_exactamente_una" CHECK ((liquidacion_cooperativa_id IS NOT NULL AND liquidacion_terminal_id IS NULL)
          OR (liquidacion_cooperativa_id IS NULL AND liquidacion_terminal_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "liquidaciones_cooperativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fin" date NOT NULL,
	"monto_ventas_bruto" numeric(12, 2) NOT NULL,
	"monto_comision_plataforma" numeric(12, 2) NOT NULL,
	"monto_ajustes" numeric(12, 2) DEFAULT '0' NOT NULL,
	"monto_liquidado" numeric(12, 2) NOT NULL,
	"estado" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"pagado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidaciones_terminal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"punto_operacion_id" uuid NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fin" date NOT NULL,
	"monto_tasa_recaudada" numeric(12, 2) NOT NULL,
	"estado" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"pagado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accion" "accion_auditoria" NOT NULL,
	"usuario_id" uuid NOT NULL,
	"entidad_tipo" varchar(50) NOT NULL,
	"entidad_id" uuid NOT NULL,
	"detalle" jsonb,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credenciales_api" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"tipo" varchar(20) NOT NULL,
	"api_key_hash" varchar(255),
	"oauth_client_id" varchar(100),
	"oauth_client_secret_hash" varchar(255),
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"revocado_en" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credenciales_api" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservas_api_externas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compra_id" uuid NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"estado" "estado_reserva_api" DEFAULT 'confirmada' NOT NULL,
	"motivo_reversa" text,
	"respondido_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservas_api_externas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhooks_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cooperativa_id" uuid NOT NULL,
	"compra_id" uuid NOT NULL,
	"evento" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"estado_entrega" varchar(20) DEFAULT 'pendiente' NOT NULL,
	"ultimo_intento_en" timestamp with time zone,
	"ultima_respuesta" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campanas_publicitarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espacio_publicitario_id" uuid NOT NULL,
	"plan_comercial_id" uuid NOT NULL,
	"lead_anunciante_id" uuid,
	"nombre_anunciante" varchar(150) NOT NULL,
	"formato" "formato_creatividad" NOT NULL,
	"archivo_url" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin" date NOT NULL,
	"estado" "estado_campana" DEFAULT 'pendiente_revision' NOT NULL,
	"aprobado_por_usuario_id" uuid,
	"aprobado_en" timestamp with time zone,
	"comprobante_electronico_id" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "espacios_publicitarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" varchar(100) NOT NULL,
	"descripcion" text,
	"ancho_px" integer,
	"alto_px" integer,
	"ubicacion" varchar(100) NOT NULL,
	"permite_rotacion" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads_anunciantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre_empresa" varchar(150) NOT NULL,
	"contacto_nombre" varchar(150),
	"contacto_correo" varchar(200) NOT NULL,
	"contacto_telefono" varchar(20),
	"mensaje" text,
	"estado" "estado_lead" DEFAULT 'nuevo' NOT NULL,
	"notas_seguimiento" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metricas_publicitarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campana_publicitaria_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"impresiones" integer DEFAULT 0 NOT NULL,
	"clics" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planes_comerciales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" "plan_comercial" NOT NULL,
	"precio_mensual" numeric(10, 2),
	"duracion_dias_default" integer,
	"formatos_permitidos" jsonb NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "puntos_operacion" ADD CONSTRAINT "puntos_operacion_cooperativa_propietaria_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_propietaria_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens_usuario" ADD CONSTRAINT "tokens_usuario_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conductores" ADD CONSTRAINT "conductores_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tipos_vehiculo" ADD CONSTRAINT "tipos_vehiculo_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_tipo_vehiculo_id_tipos_vehiculo_id_fk" FOREIGN KEY ("tipo_vehiculo_id") REFERENCES "public"."tipos_vehiculo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "horarios_ruta" ADD CONSTRAINT "horarios_ruta_ruta_id_rutas_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."rutas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_ruta_id_rutas_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."rutas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_punto_operacion_id_puntos_operacion_id_fk" FOREIGN KEY ("punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_origen_punto_operacion_id_puntos_operacion_id_fk" FOREIGN KEY ("origen_punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_destino_punto_operacion_id_puntos_operacion_id_fk" FOREIGN KEY ("destino_punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_ruta_id_rutas_id_fk" FOREIGN KEY ("ruta_id") REFERENCES "public"."rutas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_unidad_id_unidades_id_fk" FOREIGN KEY ("unidad_id") REFERENCES "public"."unidades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_conductor_id_conductores_id_fk" FOREIGN KEY ("conductor_id") REFERENCES "public"."conductores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viajes" ADD CONSTRAINT "viajes_horario_ruta_origen_id_horarios_ruta_id_fk" FOREIGN KEY ("horario_ruta_origen_id") REFERENCES "public"."horarios_ruta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje_asientos" ADD CONSTRAINT "viaje_asientos_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viaje_asientos" ADD CONSTRAINT "viaje_asientos_hold_usuario_id_usuarios_id_fk" FOREIGN KEY ("hold_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_pasajero_compra_id_pasajeros_compra_id_fk" FOREIGN KEY ("pasajero_compra_id") REFERENCES "public"."pasajeros_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_viaje_asiento_id_viaje_asientos_id_fk" FOREIGN KEY ("viaje_asiento_id") REFERENCES "public"."viaje_asientos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boletos" ADD CONSTRAINT "boletos_validado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("validado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_comprador_usuario_id_usuarios_id_fk" FOREIGN KEY ("comprador_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_vendedor_usuario_id_usuarios_id_fk" FOREIGN KEY ("vendedor_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pasajeros_compra" ADD CONSTRAINT "pasajeros_compra_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes_electronicos" ADD CONSTRAINT "comprobantes_electronicos_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes_electronicos" ADD CONSTRAINT "comprobantes_electronicos_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes_tasa_terminal" ADD CONSTRAINT "comprobantes_tasa_terminal_boleto_id_boletos_id_fk" FOREIGN KEY ("boleto_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes_tasa_terminal" ADD CONSTRAINT "comprobantes_tasa_terminal_punto_operacion_id_puntos_operacion_id_fk" FOREIGN KEY ("punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorizaciones_menor" ADD CONSTRAINT "autorizaciones_menor_pasajero_compra_id_pasajeros_compra_id_fk" FOREIGN KEY ("pasajero_compra_id") REFERENCES "public"."pasajeros_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autorizaciones_menor" ADD CONSTRAINT "autorizaciones_menor_adulto_acompanante_en_compra_id_pasajeros_compra_id_fk" FOREIGN KEY ("adulto_acompanante_en_compra_id") REFERENCES "public"."pasajeros_compra"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificaciones_menor" ADD CONSTRAINT "verificaciones_menor_boleto_id_boletos_id_fk" FOREIGN KEY ("boleto_id") REFERENCES "public"."boletos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verificaciones_menor" ADD CONSTRAINT "verificaciones_menor_verificado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("verificado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_viaje_id_viajes_id_fk" FOREIGN KEY ("viaje_id") REFERENCES "public"."viajes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_destino_id_usuarios_id_fk" FOREIGN KEY ("usuario_destino_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_liquidacion" ADD CONSTRAINT "ajustes_liquidacion_liquidacion_cooperativa_id_liquidaciones_cooperativa_id_fk" FOREIGN KEY ("liquidacion_cooperativa_id") REFERENCES "public"."liquidaciones_cooperativa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_liquidacion" ADD CONSTRAINT "ajustes_liquidacion_liquidacion_terminal_id_liquidaciones_terminal_id_fk" FOREIGN KEY ("liquidacion_terminal_id") REFERENCES "public"."liquidaciones_terminal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_liquidacion" ADD CONSTRAINT "ajustes_liquidacion_registrado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("registrado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidaciones_cooperativa" ADD CONSTRAINT "liquidaciones_cooperativa_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidaciones_terminal" ADD CONSTRAINT "liquidaciones_terminal_punto_operacion_id_puntos_operacion_id_fk" FOREIGN KEY ("punto_operacion_id") REFERENCES "public"."puntos_operacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria_admin" ADD CONSTRAINT "auditoria_admin_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credenciales_api" ADD CONSTRAINT "credenciales_api_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas_api_externas" ADD CONSTRAINT "reservas_api_externas_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas_api_externas" ADD CONSTRAINT "reservas_api_externas_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks_log" ADD CONSTRAINT "webhooks_log_cooperativa_id_cooperativas_id_fk" FOREIGN KEY ("cooperativa_id") REFERENCES "public"."cooperativas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks_log" ADD CONSTRAINT "webhooks_log_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanas_publicitarias" ADD CONSTRAINT "campanas_publicitarias_espacio_publicitario_id_espacios_publicitarios_id_fk" FOREIGN KEY ("espacio_publicitario_id") REFERENCES "public"."espacios_publicitarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanas_publicitarias" ADD CONSTRAINT "campanas_publicitarias_plan_comercial_id_planes_comerciales_id_fk" FOREIGN KEY ("plan_comercial_id") REFERENCES "public"."planes_comerciales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanas_publicitarias" ADD CONSTRAINT "campanas_publicitarias_lead_anunciante_id_leads_anunciantes_id_fk" FOREIGN KEY ("lead_anunciante_id") REFERENCES "public"."leads_anunciantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanas_publicitarias" ADD CONSTRAINT "campanas_publicitarias_aprobado_por_usuario_id_usuarios_id_fk" FOREIGN KEY ("aprobado_por_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campanas_publicitarias" ADD CONSTRAINT "campanas_publicitarias_comprobante_electronico_id_comprobantes_electronicos_id_fk" FOREIGN KEY ("comprobante_electronico_id") REFERENCES "public"."comprobantes_electronicos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metricas_publicitarias" ADD CONSTRAINT "metricas_publicitarias_campana_publicitaria_id_campanas_publicitarias_id_fk" FOREIGN KEY ("campana_publicitaria_id") REFERENCES "public"."campanas_publicitarias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cooperativas_ruc" ON "cooperativas" USING btree ("ruc");--> statement-breakpoint
CREATE INDEX "idx_cooperativas_estado" ON "cooperativas" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_puntos_operacion_tipo" ON "puntos_operacion" USING btree ("tipo");--> statement-breakpoint
CREATE INDEX "idx_puntos_operacion_ciudad" ON "puntos_operacion" USING btree ("ciudad");--> statement-breakpoint
CREATE INDEX "idx_puntos_operacion_cooperativa_propietaria" ON "puntos_operacion" USING btree ("cooperativa_propietaria_id");--> statement-breakpoint
CREATE INDEX "idx_tokens_usuario_usuario" ON "tokens_usuario" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "idx_tokens_usuario_proposito" ON "tokens_usuario" USING btree ("proposito");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usuarios_correo" ON "usuarios" USING btree ("correo");--> statement-breakpoint
CREATE INDEX "idx_usuarios_cooperativa" ON "usuarios" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_usuarios_rol" ON "usuarios" USING btree ("rol");--> statement-breakpoint
CREATE INDEX "idx_conductores_cooperativa" ON "conductores" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_tipos_vehiculo_cooperativa" ON "tipos_vehiculo" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_unidades_cooperativa" ON "unidades" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_unidades_tipo_vehiculo" ON "unidades" USING btree ("tipo_vehiculo_id");--> statement-breakpoint
CREATE INDEX "idx_horarios_ruta_ruta" ON "horarios_ruta" USING btree ("ruta_id");--> statement-breakpoint
CREATE INDEX "idx_ruta_paradas_ruta" ON "ruta_paradas" USING btree ("ruta_id");--> statement-breakpoint
CREATE INDEX "idx_ruta_paradas_orden" ON "ruta_paradas" USING btree ("ruta_id","orden");--> statement-breakpoint
CREATE INDEX "idx_rutas_cooperativa" ON "rutas" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_rutas_origen_destino" ON "rutas" USING btree ("origen_punto_operacion_id","destino_punto_operacion_id");--> statement-breakpoint
CREATE INDEX "idx_viajes_cooperativa" ON "viajes" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_viajes_ruta_fecha" ON "viajes" USING btree ("ruta_id","fecha_salida");--> statement-breakpoint
CREATE INDEX "idx_viajes_fecha_hora" ON "viajes" USING btree ("fecha_salida","hora_salida_programada");--> statement-breakpoint
CREATE INDEX "idx_viajes_unidad" ON "viajes" USING btree ("unidad_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_viaje_asientos_viaje_numero" ON "viaje_asientos" USING btree ("viaje_id","numero_asiento");--> statement-breakpoint
CREATE INDEX "idx_viaje_asientos_estado" ON "viaje_asientos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_viaje_asientos_hold_expira" ON "viaje_asientos" USING btree ("hold_expira_en");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_boletos_viaje_asiento" ON "boletos" USING btree ("viaje_asiento_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_boletos_codigo_qr" ON "boletos" USING btree ("codigo_qr");--> statement-breakpoint
CREATE INDEX "idx_boletos_cooperativa" ON "boletos" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_boletos_compra" ON "boletos" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_boletos_pasajero_compra" ON "boletos" USING btree ("pasajero_compra_id");--> statement-breakpoint
CREATE INDEX "idx_compras_comprador" ON "compras" USING btree ("comprador_usuario_id");--> statement-breakpoint
CREATE INDEX "idx_compras_vendedor" ON "compras" USING btree ("vendedor_usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pagos_idempotency_key" ON "pagos" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_pagos_compra" ON "pagos" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_pagos_estado" ON "pagos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_pasajeros_compra_compra" ON "pasajeros_compra" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_comprobantes_electronicos_compra" ON "comprobantes_electronicos" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_comprobantes_electronicos_sujeto" ON "comprobantes_electronicos" USING btree ("sujeto_tributario");--> statement-breakpoint
CREATE INDEX "idx_comprobantes_electronicos_estado" ON "comprobantes_electronicos" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_comprobantes_tasa_terminal_boleto" ON "comprobantes_tasa_terminal" USING btree ("boleto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_comprobantes_tasa_terminal_codigo" ON "comprobantes_tasa_terminal" USING btree ("codigo_verificacion");--> statement-breakpoint
CREATE INDEX "idx_comprobantes_tasa_terminal_punto" ON "comprobantes_tasa_terminal" USING btree ("punto_operacion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_autorizaciones_menor_pasajero_compra" ON "autorizaciones_menor" USING btree ("pasajero_compra_id");--> statement-breakpoint
CREATE INDEX "idx_autorizaciones_menor_adulto_acompanante" ON "autorizaciones_menor" USING btree ("adulto_acompanante_en_compra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_verificaciones_menor_boleto" ON "verificaciones_menor" USING btree ("boleto_id");--> statement-breakpoint
CREATE INDEX "idx_verificaciones_menor_verificado_por" ON "verificaciones_menor" USING btree ("verificado_por_usuario_id");--> statement-breakpoint
CREATE INDEX "idx_notificaciones_compra" ON "notificaciones" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_notificaciones_viaje" ON "notificaciones" USING btree ("viaje_id");--> statement-breakpoint
CREATE INDEX "idx_notificaciones_estado_envio" ON "notificaciones" USING btree ("estado_envio");--> statement-breakpoint
CREATE INDEX "idx_ajustes_liquidacion_cooperativa" ON "ajustes_liquidacion" USING btree ("liquidacion_cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_ajustes_liquidacion_terminal" ON "ajustes_liquidacion" USING btree ("liquidacion_terminal_id");--> statement-breakpoint
CREATE INDEX "idx_liquidaciones_cooperativa_cooperativa" ON "liquidaciones_cooperativa" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_liquidaciones_cooperativa_periodo" ON "liquidaciones_cooperativa" USING btree ("periodo_inicio","periodo_fin");--> statement-breakpoint
CREATE INDEX "idx_liquidaciones_terminal_punto" ON "liquidaciones_terminal" USING btree ("punto_operacion_id");--> statement-breakpoint
CREATE INDEX "idx_liquidaciones_terminal_periodo" ON "liquidaciones_terminal" USING btree ("periodo_inicio","periodo_fin");--> statement-breakpoint
CREATE INDEX "idx_auditoria_admin_usuario" ON "auditoria_admin" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "idx_auditoria_admin_entidad" ON "auditoria_admin" USING btree ("entidad_tipo","entidad_id");--> statement-breakpoint
CREATE INDEX "idx_auditoria_admin_accion" ON "auditoria_admin" USING btree ("accion");--> statement-breakpoint
CREATE INDEX "idx_credenciales_api_cooperativa" ON "credenciales_api" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_reservas_api_externas_compra" ON "reservas_api_externas" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "idx_reservas_api_externas_cooperativa" ON "reservas_api_externas" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_log_cooperativa" ON "webhooks_log" USING btree ("cooperativa_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_log_estado" ON "webhooks_log" USING btree ("estado_entrega");--> statement-breakpoint
CREATE INDEX "idx_campanas_publicitarias_espacio" ON "campanas_publicitarias" USING btree ("espacio_publicitario_id");--> statement-breakpoint
CREATE INDEX "idx_campanas_publicitarias_estado" ON "campanas_publicitarias" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_campanas_publicitarias_vigencia" ON "campanas_publicitarias" USING btree ("fecha_inicio","fecha_fin");--> statement-breakpoint
CREATE INDEX "idx_leads_anunciantes_estado" ON "leads_anunciantes" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_metricas_publicitarias_campana_fecha" ON "metricas_publicitarias" USING btree ("campana_publicitaria_id","fecha");--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_usuarios" ON "usuarios" AS PERMISSIVE FOR ALL TO "ticketya_app" USING ((cooperativa_id IS NULL OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK ((cooperativa_id IS NULL OR cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_conductores" ON "conductores" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_tipos_vehiculo" ON "tipos_vehiculo" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_unidades" ON "unidades" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_rutas" ON "rutas" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_viajes" ON "viajes" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_viaje_asientos" ON "viaje_asientos" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (viaje_id IN (SELECT id FROM viajes WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid)) WITH CHECK (viaje_id IN (SELECT id FROM viajes WHERE cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_boletos" ON "boletos" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_credenciales_api" ON "credenciales_api" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_reservas_api_externas" ON "reservas_api_externas" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "aislamiento_cooperativa_webhooks_log" ON "webhooks_log" AS PERMISSIVE FOR ALL TO "ticketya_app" USING (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid) WITH CHECK (cooperativa_id = NULLIF(current_setting('app.current_cooperativa_id', true), '')::uuid);