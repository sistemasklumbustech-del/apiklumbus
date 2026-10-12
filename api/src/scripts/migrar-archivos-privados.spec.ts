import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarArchivosPrivados } from './migrar-archivos-privados';

const A = '3f2b8c1e-5a47-4d0e-9b36-1c2d3e4f5a6b.webp';
const B = '9a8b7c6d-1111-4222-8333-444455556666.pdf';
const URL_PUBLICA = (n: string) => `https://api.klumbus.tech/uploads/comprobantes-pago/${n}`;

/** Una base de datos de mentira que recuerda lo que se le pidió. */
function baseFalsa(filas: { id: string; comprobante_url: string }[]) {
  const actualizaciones: { referencia: string; id: string }[] = [];
  return {
    actualizaciones,
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: filas.filter((f) => f.comprobante_url.includes('/uploads/comprobantes-pago/')) });
      actualizaciones.push({ referencia: params[0] as string, id: params[1] as string });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }),
  };
}

describe('migración de comprobantes a la carpeta privada', () => {
  let raiz: string;
  let publica: string;
  let privada: string;

  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), 'klumbus-archivos-'));
    publica = join(raiz, 'uploads');
    privada = join(raiz, 'privado');
    await mkdir(join(publica, 'comprobantes-pago'), { recursive: true });
  });
  afterEach(async () => {
    await rm(raiz, { recursive: true, force: true });
  });

  it('mueve los archivos fuera de la carpeta pública y cambia sus URLs por referencias', async () => {
    await writeFile(join(publica, 'comprobantes-pago', A), 'imagen');
    await writeFile(join(publica, 'comprobantes-pago', B), '%PDF-1.4');
    const bd = baseFalsa([
      { id: 'p1', comprobante_url: URL_PUBLICA(A) },
      { id: 'p2', comprobante_url: URL_PUBLICA(B) },
    ]);

    const r = await migrarArchivosPrivados(bd as never, publica, privada);

    expect(r).toEqual({ archivosMovidos: 2, referenciasActualizadas: 2 });
    expect((await readdir(join(publica, 'comprobantes-pago'))).sort()).toEqual([]);
    expect((await readdir(join(privada, 'comprobantes-pago'))).sort()).toEqual([A, B].sort());
    expect(bd.actualizaciones).toEqual([
      { referencia: `privado://comprobantes-pago/${A}`, id: 'p1' },
      { referencia: `privado://comprobantes-pago/${B}`, id: 'p2' },
    ]);
  });

  it('repetirlo no hace nada más', async () => {
    await writeFile(join(publica, 'comprobantes-pago', A), 'imagen');
    await migrarArchivosPrivados(baseFalsa([{ id: 'p1', comprobante_url: URL_PUBLICA(A) }]) as never, publica, privada);

    // Segunda corrida: la base ya tiene la referencia, así que la consulta de URLs públicas no devuelve nada.
    const bd = baseFalsa([{ id: 'p1', comprobante_url: `privado://comprobantes-pago/${A}` }]);
    const r = await migrarArchivosPrivados(bd as never, publica, privada);
    expect(r).toEqual({ archivosMovidos: 0, referenciasActualizadas: 0 });
  });

  it('termina el trabajo de una corrida que se cortó después de mover el archivo', async () => {
    await mkdir(join(privada, 'comprobantes-pago'), { recursive: true });
    await writeFile(join(privada, 'comprobantes-pago', A), 'imagen'); // ya movido, base sin actualizar
    const bd = baseFalsa([{ id: 'p1', comprobante_url: URL_PUBLICA(A) }]);

    const r = await migrarArchivosPrivados(bd as never, publica, privada);
    expect(r).toEqual({ archivosMovidos: 0, referenciasActualizadas: 1 });
  });

  it('no toca una URL cuyo archivo no está en la carpeta privada, ni archivos con nombres raros', async () => {
    await writeFile(join(publica, 'comprobantes-pago', 'foto-con-nombre-raro.png'), 'x');
    const bd = baseFalsa([{ id: 'p1', comprobante_url: URL_PUBLICA(A) }]); // el archivo A no existe en ningún lado

    const r = await migrarArchivosPrivados(bd as never, publica, privada);
    expect(r).toEqual({ archivosMovidos: 0, referenciasActualizadas: 0 });
    expect(await readdir(join(publica, 'comprobantes-pago'))).toEqual(['foto-con-nombre-raro.png']);
  });

  it('sin carpeta pública no falla', async () => {
    await rm(publica, { recursive: true, force: true });
    const r = await migrarArchivosPrivados(baseFalsa([]) as never, publica, privada);
    expect(r).toEqual({ archivosMovidos: 0, referenciasActualizadas: 0 });
  });
});
