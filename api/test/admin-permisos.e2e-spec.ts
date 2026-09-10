import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { Client } from 'pg';
import { limpiarCooperativasDePrueba } from './helpers/limpieza';

/**
 * Ítem 9, Fase 2 (04-ago-2026) — frontera de seguridad entre
 * `super_admin` y `admin_plataforma` (matriz de permisos, sección 3.8
 * del documento maestro). Orden explícita del director: esto es un
 * CONTROL DE SEGURIDAD, no una función más -- no es opcional tener
 * pruebas propias que confirmen que de verdad bloquea, no solo que
 * "debería" bloquear según el código.
 *
 * Cubre las 2 direcciones:
 * 1) admin_plataforma recibe 403 en los 3 endpoints exclusivos.
 * 2) super_admin sí puede usarlos -- de nada sirve confirmar que algo
 *    está bloqueado si nunca se confirma que lo mismo funciona para
 *    quien sí debería poder.
 */
describe('Frontera de seguridad: super_admin vs admin_plataforma (e2e)', () => {
  let app: INestApplication<App>;
  const sufijo = Date.now();

  const correoSuperAdmin = `super.admin.permisos.${sufijo}@ticketya.ec`;
  const correoAdminPlataforma = `admin.plataforma.permisos.${sufijo}@ticketya.ec`;

  let tokenSuperAdmin: string;
  let tokenAdminPlataforma: string;
  let cooperativaIdParaEliminar: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    // Dos cuentas -- una de cada rol -- para probar ambas direcciones
    // de la frontera, no solo el rechazo.
    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoSuperAdmin,
        password: 'ClaveSegura123',
        nombres: 'Super',
        apellidos: 'Admin Permisos E2E',
        cedula: '0999999995',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/registro')
      .send({
        correo: correoAdminPlataforma,
        password: 'ClaveSegura123',
        nombres: 'Admin',
        apellidos: 'Plataforma Permisos E2E',
        cedula: '0999999994',
      })
      .expect(201);

    const pg = new Client({
      connectionString:
        process.env.DATABASE_URL_ADMIN_DIRECTO ??
        process.env.DATABASE_URL_PUBLICO,
    });
    await pg.connect();
    await pg.query("UPDATE usuarios SET rol='super_admin' WHERE correo=$1", [
      correoSuperAdmin,
    ]);
    await pg.query(
      "UPDATE usuarios SET rol='admin_plataforma' WHERE correo=$1",
      [correoAdminPlataforma],
    );
    await pg.end();

    const loginSuperAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoSuperAdmin, password: 'ClaveSegura123' })
      .expect(201);
    tokenSuperAdmin = loginSuperAdmin.body.accessToken;

    const loginAdminPlataforma = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ correo: correoAdminPlataforma, password: 'ClaveSegura123' })
      .expect(201);
    tokenAdminPlataforma = loginAdminPlataforma.body.accessToken;

    // Cooperativa real para el par de pruebas de eliminarCooperativa
    // (negativa con admin_plataforma, positiva con super_admin).
    const ruc = `09${sufijo}`.slice(0, 13);
    const coopRes = await request(app.getHttpServer())
      .post('/admin/cooperativas')
      .set('Authorization', `Bearer ${tokenSuperAdmin}`)
      .send({
        cooperativa: {
          ruc,
          razonSocial: 'Cooperativa Permisos E2E S.A.',
          nombreComercial: 'Coop Permisos E2E',
          modeloIntegracion: 'modelo_a',
        },
        usuario: {
          correo: `admin.coop.permisos.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Admin Coop Permisos E2E',
        },
      })
      .expect(201);
    cooperativaIdParaEliminar = coopRes.body.cooperativaId;
  });

  afterAll(async () => {
    await limpiarCooperativasDePrueba(['Coop Permisos E2E']);
    await app.close();
  });

  describe('admin_plataforma recibe 403 en los endpoints exclusivos de super_admin', () => {
    it('no puede crear otro administrador', async () => {
      await request(app.getHttpServer())
        .post('/admin/administradores')
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`)
        .send({
          correo: `intento.no.autorizado.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'No Debería Existir',
          rol: 'admin_plataforma',
        })
        .expect(403);
    });

    it('no puede eliminar (dar de baja) un administrador', async () => {
      // Un id inventado es suficiente -- RolesGuard rechaza ANTES de
      // que el controller siquiera intente buscar el id.
      await request(app.getHttpServer())
        .delete('/admin/administradores/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`)
        .expect(403);
    });

    it('no puede eliminar (dar de baja) una cooperativa', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/cooperativas/${cooperativaIdParaEliminar}`)
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`)
        .expect(403);
    });

    it('no puede cambiar el cargo de plataforma', async () => {
      await request(app.getHttpServer())
        .patch('/admin/cargo-plataforma')
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`)
        .send({ monto: 0.99 })
        .expect(403);
    });

    it('no puede cambiar el modo de IVA del boleto', async () => {
      await request(app.getHttpServer())
        .patch('/admin/modo-iva-boleto')
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`)
        .send({ modo: 'oculto' })
        .expect(403);
    });
  });

  describe('super_admin sí puede usar los endpoints exclusivos -- confirma que el bloqueo de arriba es específico, no un error general', () => {
    let idAdministradorCreado: string;

    it('puede crear un administrador nuevo', async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/administradores')
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .send({
          correo: `creado.por.super.admin.${sufijo}@ticketya.ec`,
          password: 'ClaveSegura123',
          nombreCompleto: 'Creado Por Super Admin E2E',
          rol: 'admin_plataforma',
        })
        .expect(201);
      idAdministradorCreado = res.body.id;
      expect(idAdministradorCreado).toBeDefined();
    });

    it('el administrador nuevo aparece al listar (endpoint compartido)', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/administradores')
        .set('Authorization', `Bearer ${tokenAdminPlataforma}`) // compartido: admin_plataforma también puede listar
        .expect(200);
      const encontrado = res.body.find(
        (a: { id: string }) => a.id === idAdministradorCreado,
      );
      expect(encontrado).toBeDefined();
      expect(encontrado.activo).toBe(true);
    });

    it('puede eliminar (dar de baja) el administrador que acaba de crear', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/administradores/${idAdministradorCreado}`)
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/admin/administradores')
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .expect(200);
      const encontrado = res.body.find(
        (a: { id: string }) => a.id === idAdministradorCreado,
      );
      expect(encontrado.activo).toBe(false); // baja lógica, no desapareció de la lista
    });

    it('puede cambiar el cargo de plataforma', async () => {
      await request(app.getHttpServer())
        .patch('/admin/cargo-plataforma')
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .send({ monto: 0.55 })
        .expect(200);
    });

    it('puede cambiar el modo de IVA del boleto', async () => {
      await request(app.getHttpServer())
        .patch('/admin/modo-iva-boleto')
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .send({ modo: 'calculado' })
        .expect(200);
    });

    it('puede eliminar (dar de baja) la cooperativa de prueba', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/cooperativas/${cooperativaIdParaEliminar}`)
        .set('Authorization', `Bearer ${tokenSuperAdmin}`)
        .expect(200);

      const pg = new Client({
        connectionString:
          process.env.DATABASE_URL_ADMIN_DIRECTO ??
          process.env.DATABASE_URL_PUBLICO,
      });
      await pg.connect();
      const fila = await pg.query('SELECT estado FROM cooperativas WHERE id = $1', [
        cooperativaIdParaEliminar,
      ]);
      await pg.end();
      expect(fila.rows[0].estado).toBe('dada_de_baja'); // baja lógica, no desapareció la fila
    });
  });
});
