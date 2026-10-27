import { beforeEach, describe, expect, it } from 'vitest';
import type { Resumen, RespuestaChat } from '../shared/types';
import { api, fakeAI, gasto, login, resetDb, scriptedAI } from './helpers';

let cookie: string;

beforeEach(async () => {
  await resetDb();
  cookie = await login();
});

async function chat(body: Record<string, unknown>, ai: Ai): Promise<RespuestaChat> {
  const res = await api('/api/chat', { method: 'POST', body, cookie, ai });
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json();
}

function saldo(summary: Resumen, nombre: string): number | undefined {
  return summary.cuentas.find((c) => c.nombre === nombre)?.saldo;
}

describe('sesión', () => {
  it('protege la API sin cookie', async () => {
    expect((await api('/api/summary')).status).toBe(401);
    expect((await api('/api/transactions')).status).toBe(401);
    expect((await api('/api/reset', { method: 'POST' })).status).toBe(401);
  });

  it('rechaza una cookie alterada', async () => {
    const [name, value] = cookie.split('=');
    const forged = `${name}=${value.slice(0, -3)}abc`;
    expect((await api('/api/summary', { cookie: forged })).status).toBe(401);
  });

  it('bloquea después de 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await api('/api/login', { method: 'POST', body: { username: 'mario', password: 'mala' } });
      expect(res.status).toBe(401);
    }
    const res = await api('/api/login', { method: 'POST', body: { username: 'mario', password: 'clave-de-prueba' } });
    expect(res.status).toBe(429);
  });

  it('rechaza peticiones de otro origen', async () => {
    const res = await api('/api/reset', { method: 'POST', cookie, headers: { Origin: 'https://malo.example' } });
    expect(res.status).toBe(403);
  });

  it('arranca con la cuenta Efectivo', async () => {
    const summary: Resumen = await (await api('/api/summary', { cookie })).json();
    expect(summary.cuentas).toEqual([{ id: expect.any(Number), nombre: 'Efectivo', tipo: 'efectivo', principal: true, saldo: 0 }]);
  });
});

describe('chat', () => {
  it('registra un gasto en la cuenta principal y responde', async () => {
    const out = await chat(
      { message: 'gasté 80 mil en mercado' },
      scriptedAI({ acciones: [gasto(80000)], reply: 'Anotado parce 🛒' }),
    );
    expect(out.reply).toBe('Anotado parce 🛒');
    expect(out.applied.movimientos).toHaveLength(1);
    expect(out.applied.movimientos[0]).toMatchObject({ tipo: 'gasto', monto: 80000, categoria: 'Comida - Mercado', cuenta: 'Efectivo', fuente: 'chat' });
    expect(saldo(out.summary, 'Efectivo')).toBe(-80000);
    expect(out.summary.mes.gastos).toBe(80000);
    expect(out.summary.mes.porCategoria).toEqual([{ grupo: 'Comida', monto: 80000 }]);
  });

  it('no registra nada en preguntas', async () => {
    const out = await chat({ message: '¿cuánto tengo?' }, scriptedAI({ acciones: [], reply: 'Tienes $ 0' }));
    expect(out.applied.movimientos).toEqual([]);
    expect(out.reply).toBe('Tienes $ 0');
  });

  it('maneja saldos, cuentas nuevas, transferencias y tarjeta de crédito', async () => {
    let out = await chat(
      { message: 'tengo 2 millones en Bancolombia' },
      scriptedAI({ acciones: [{ accion: 'saldo', monto: 2_000_000, cuenta: 'Bancolombia', tipo_cuenta: 'banco' }] }),
    );
    expect(out.applied.cuentasCreadas).toEqual(['Bancolombia']);
    expect(saldo(out.summary, 'Bancolombia')).toBe(2_000_000);
    // Un saldo inicial no cuenta como ingreso del mes
    expect(out.summary.mes.ingresos).toBe(0);

    out = await chat(
      { message: 'pasé 200 mil de Bancolombia a Nequi' },
      scriptedAI({ acciones: [{ accion: 'transferencia', monto: 200_000, cuenta: 'bancolombia', cuenta_destino: 'Nequi', tipo_cuenta: 'billetera' }] }),
    );
    expect(out.applied.cuentasCreadas).toEqual(['Nequi']);
    expect(out.summary.cuentas.find((c) => c.nombre === 'Nequi')?.tipo).toBe('billetera');
    expect(saldo(out.summary, 'Bancolombia')).toBe(1_800_000);
    expect(saldo(out.summary, 'Nequi')).toBe(200_000);

    out = await chat(
      { message: 'debo 1.2 millones en la Visa' },
      scriptedAI({ acciones: [{ accion: 'saldo', monto: 1_200_000, cuenta: 'la Visa', tipo_cuenta: 'credito' }] }),
    );
    expect(out.applied.cuentasCreadas).toEqual(['Visa']);
    expect(saldo(out.summary, 'Visa')).toBe(-1_200_000);

    out = await chat(
      { message: 'almuerzo 25 mil con la tarjeta' },
      scriptedAI({ acciones: [gasto(25_000, { categoria: 'Comida - Restaurantes', cuenta: 'la tarjeta', tipo_cuenta: 'credito' })] }),
    );
    expect(out.applied.cuentasCreadas).toEqual([]);
    expect(saldo(out.summary, 'Visa')).toBe(-1_225_000);

    out = await chat(
      { message: 'pagué 500 mil de la tarjeta desde Bancolombia' },
      scriptedAI({ acciones: [{ accion: 'transferencia', monto: 500_000, cuenta: 'Bancolombia', cuenta_destino: 'la tarjeta', tipo_cuenta: 'credito' }] }),
    );
    expect(saldo(out.summary, 'Visa')).toBe(-725_000);
    expect(saldo(out.summary, 'Bancolombia')).toBe(1_300_000);
    expect(out.summary.totales).toEqual({ tienes: 1_500_000, debes: 725_000, neto: 775_000 });
  });

  it('registra varios movimientos, fechas pasadas y categorías inventadas', async () => {
    const ayer = new Date(Date.now() - 2 * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10);
    const out = await chat(
      { message: 'almuerzo 20 mil y taxi 12 mil antier' },
      scriptedAI({
        acciones: [
          gasto(20_000, { categoria: 'Comida inventada' }),
          gasto(12_000, { categoria: 'Transporte - Apps de movilidad', fecha: ayer }),
          gasto(-5, {}),
        ],
      }),
    );
    expect(out.applied.movimientos.map((m) => m.categoria)).toEqual(['Comida - Otros', 'Transporte - Apps de movilidad']);
    expect(out.applied.movimientos[1].fecha).toBe(`${ayer}T17:00:00.000Z`);
    expect(out.applied.avisos).toHaveLength(1);
  });

  it('define presupuestos y los compara con lo gastado', async () => {
    let out = await chat(
      { message: 'ponme 600 mil de presupuesto para comida' },
      scriptedAI({ acciones: [{ accion: 'presupuesto', monto: 600_000, categoria: 'comida' }] }),
    );
    expect(out.applied.presupuestos).toEqual([{ categoria: 'Comida', monto: 600_000 }]);

    out = await chat({ message: 'mercado 450 mil' }, scriptedAI({ acciones: [gasto(450_000)] }));
    expect(out.summary.mes.presupuestos).toEqual([{ categoria: 'Comida', monto: 600_000, gastado: 450_000 }]);
  });

  it('le pasa a Aura el contexto con cifras ya formateadas', async () => {
    const calls: { model: string; inputs: Record<string, unknown> }[] = [];
    await chat({ message: 'gasté 80 mil en mercado' }, scriptedAI({ acciones: [gasto(80000)], calls }));
    const replyCall = calls.find((c) => !c.inputs.response_format)!;
    const system = (replyCall.inputs.messages as { role: string; content: string }[])[0].content;
    expect(system).toContain('$ 80.000');
    expect(system).toContain('Gasto de $ 80.000 en Comida - Mercado');
  });

  it('transcribe notas de voz con Whisper', async () => {
    const calls: { model: string; inputs: Record<string, unknown> }[] = [];
    const out = await chat(
      { audio: 'data:audio/wav;base64,UklGRg==' },
      scriptedAI({ transcript: 'gasté veinte mil en bus', acciones: [gasto(20_000, { categoria: 'Transporte - Público' })], calls }),
    );
    expect(out.transcript).toBe('gasté veinte mil en bus');
    expect(out.applied.movimientos[0]).toMatchObject({ monto: 20_000, fuente: 'voz' });
    expect(calls[0]).toMatchObject({ model: '@cf/openai/whisper-large-v3-turbo', inputs: { audio: 'UklGRg==', language: 'es' } });
    const extraction = calls[1].inputs.messages as { content: string }[];
    expect(extraction[1].content).toBe('gasté veinte mil en bus');
  });

  it('lee recibos con la cámara', async () => {
    const out = await chat(
      { image: 'data:image/jpeg;base64,/9j/AAA=', message: 'pagué con Nequi' },
      scriptedAI({
        receipt: { es_recibo: true, total: 45_900, comercio: 'Éxito', fecha: '', categoria: 'Comida - Mercado', cuenta: 'Nequi', tipo_cuenta: 'billetera' },
      }),
    );
    expect(out.applied.movimientos[0]).toMatchObject({ tipo: 'gasto', monto: 45_900, descripcion: 'Éxito', cuenta: 'Nequi', fuente: 'foto' });
  });

  it('avisa cuando la foto no es un recibo', async () => {
    const out = await chat({ image: 'data:image/png;base64,iVBOR=' }, scriptedAI({ receipt: { es_recibo: false } }));
    expect(out.applied.movimientos).toEqual([]);
    expect(out.reply).toMatch(/no pude leer/i);
  });

  it('responde 503 claro si Workers AI falla', async () => {
    const res = await api('/api/chat', {
      method: 'POST',
      body: { message: 'gasté 10 mil' },
      cookie,
      ai: fakeAI(() => {
        throw new Error('quota exceeded');
      }),
    });
    expect(res.status).toBe(503);
    expect((await res.json<{ error: string }>()).error).toMatch(/cuota/);
  });

  it('usa una respuesta sin IA si falla solo la redacción', async () => {
    const ai = fakeAI((_m, inputs) => {
      if (inputs.response_format) return { response: { acciones: [gasto(15_000)] } };
      throw new Error('timeout');
    });
    const out = await chat({ message: 'mercado 15 mil' }, ai);
    expect(out.reply).toMatch(/anoté/);
    expect(out.applied.movimientos).toHaveLength(1);
  });

  it('entiende respuestas JSON como texto con bloques de código', async () => {
    const ai = fakeAI((_m, inputs) => {
      if (inputs.response_format) return { response: '```json\n{"acciones":[{"accion":"ingreso","monto":1800000,"categoria":"Salario"}]}\n```' };
      return { response: 'Bacano' };
    });
    const out = await chat({ message: 'me pagaron' }, ai);
    expect(out.applied.movimientos[0]).toMatchObject({ tipo: 'ingreso', monto: 1_800_000, categoria: 'Salario' });
    expect(out.summary.mes.ingresos).toBe(1_800_000);
  });
});

describe('cuentas, historial y presupuestos', () => {
  it('deshace un movimiento', async () => {
    const out = await chat({ message: 'mercado' }, scriptedAI({ acciones: [gasto(30_000)] }));
    const id = out.applied.movimientos[0].id;
    const res = await api(`/api/transactions/${id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(200);
    const { summary } = await res.json<{ summary: Resumen }>();
    expect(saldo(summary, 'Efectivo')).toBe(0);
    expect((await api(`/api/transactions/${id}`, { method: 'DELETE', cookie })).status).toBe(404);
  });

  it('crea, edita y quita cuentas con reglas claras', async () => {
    let res = await api('/api/accounts', { method: 'POST', cookie, body: { nombre: 'Davivienda', tipo: 'banco', saldo: 500_000 } });
    let summary = (await res.json<{ summary: Resumen }>()).summary;
    const davi = summary.cuentas.find((c) => c.nombre === 'Davivienda')!;
    expect(davi.saldo).toBe(500_000);

    res = await api('/api/accounts', { method: 'POST', cookie, body: { nombre: 'davivienda', tipo: 'banco' } });
    expect(res.status).toBe(400);

    res = await api(`/api/accounts/${davi.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toMatch(/todavía tiene/);

    res = await api(`/api/accounts/${davi.id}`, { method: 'PATCH', cookie, body: { principal: true, saldo: 0 } });
    summary = (await res.json<{ summary: Resumen }>()).summary;
    expect(summary.cuentas[0]).toMatchObject({ nombre: 'Davivienda', principal: true, saldo: 0 });

    res = await api(`/api/accounts/${davi.id}`, { method: 'DELETE', cookie });
    expect(res.status).toBe(400); // es la principal

    const efectivo = summary.cuentas.find((c) => c.nombre === 'Efectivo')!;
    await api(`/api/accounts/${efectivo.id}`, { method: 'PATCH', cookie, body: { principal: true } });
    res = await api(`/api/accounts/${davi.id}`, { method: 'DELETE', cookie });
    expect(await res.json()).toMatchObject({ resultado: 'archivada' });
  });

  it('lista el historial con nombres de cuentas', async () => {
    await chat(
      { message: 'pasé 50 mil a ahorros' },
      scriptedAI({ acciones: [{ accion: 'transferencia', monto: 50_000, cuenta: '', cuenta_destino: 'Ahorros', tipo_cuenta: 'ahorro' }] }),
    );
    const list = await (await api('/api/transactions', { cookie })).json<{ cuenta: string; cuenta_destino: string; tipo: string }[]>();
    expect(list[0]).toMatchObject({ tipo: 'transferencia', cuenta: 'Efectivo', cuenta_destino: 'Ahorros' });
  });

  it('administra presupuestos desde la app', async () => {
    let res = await api('/api/budgets', { method: 'PUT', cookie, body: { categoria: 'Transporte', monto: 200_000 } });
    expect((await res.json<{ summary: Resumen }>()).summary.mes.presupuestos).toEqual([{ categoria: 'Transporte', monto: 200_000, gastado: 0 }]);
    res = await api('/api/budgets', { method: 'PUT', cookie, body: { categoria: 'Cosas raras', monto: 1 } });
    expect(res.status).toBe(400);
    res = await api('/api/budgets/Transporte', { method: 'DELETE', cookie });
    expect((await res.json<{ summary: Resumen }>()).summary.mes.presupuestos).toEqual([]);
  });

  it('reinicia todo', async () => {
    await chat({ message: 'tengo 1 millón en Nequi' }, scriptedAI({ acciones: [{ accion: 'saldo', monto: 1_000_000, cuenta: 'Nequi' }] }));
    const res = await api('/api/reset', { method: 'POST', cookie });
    const { summary } = await res.json<{ summary: Resumen }>();
    expect(summary.cuentas.map((c) => c.nombre)).toEqual(['Efectivo']);
    expect(summary.totales.neto).toBe(0);
  });
});
