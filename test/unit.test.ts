import { describe, expect, it } from 'vitest';
import { bogotaDay, bogotaMonth, monthRange, resolveTxDate, shiftMonth } from '../worker/dates';
import { normalizeCategory, normalizeGroup } from '../worker/categories';
import { displayName, findAccount, inferKind } from '../worker/accounts';
import { parseJsonOutput, sanitizeActions } from '../worker/ai';
import type { Cuenta } from '../shared/types';

describe('fechas en hora de Colombia', () => {
  it('usa UTC-5', () => {
    const lateNight = new Date('2026-11-01T03:00:00Z'); // 31 oct, 10 p.m. en Bogotá
    expect(bogotaDay(lateNight)).toBe('2026-10-31');
    expect(bogotaMonth(lateNight)).toBe('2026-10');
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01T05:00:00.000Z', end: '2026-11-01T05:00:00.000Z' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('resuelve fechas que dice la IA', () => {
    const now = new Date('2026-10-27T15:00:00Z');
    expect(resolveTxDate('', now)).toBe(now.toISOString());
    expect(resolveTxDate('2026-10-26', now)).toBe('2026-10-26T17:00:00.000Z');
    expect(resolveTxDate('2026-10-27', now)).toBe(now.toISOString()); // hoy
    expect(resolveTxDate('2026-12-01', now)).toBe(now.toISOString()); // futuro
    expect(resolveTxDate('2026-02-30', now)).toBe(now.toISOString()); // no existe
    expect(resolveTxDate('2020-01-01', now)).toBe(now.toISOString()); // muy viejo
  });
});

describe('categorías', () => {
  it('normaliza lo que diga la IA', () => {
    expect(normalizeCategory('comida - mercado', 'gasto')).toBe('Comida - Mercado');
    expect(normalizeCategory('Mascotas', 'gasto')).toBe('Mascotas - Comida');
    expect(normalizeCategory('cualquier cosa', 'gasto')).toBe('Otros gastos');
    expect(normalizeCategory('salario', 'ingreso')).toBe('Salario');
    expect(normalizeCategory('Comida - Mercado', 'ingreso')).toBe('Otros ingresos');
  });

  it('reconoce grupos para presupuestos', () => {
    expect(normalizeGroup('comida')).toBe('Comida');
    expect(normalizeGroup('Educacion')).toBe('Educación');
    expect(normalizeGroup('Transporte - Gasolina')).toBe('Transporte');
    expect(normalizeGroup('los almuerzos')).toBe('Comida');
    expect(normalizeGroup('xyz')).toBeNull();
  });
});

describe('cuentas', () => {
  const cuentas: Cuenta[] = [
    { id: 1, nombre: 'Efectivo', tipo: 'efectivo', principal: true, saldo: 0 },
    { id: 2, nombre: 'Bancolombia', tipo: 'banco', principal: false, saldo: 0 },
    { id: 3, nombre: 'Tarjeta Visa', tipo: 'credito', principal: false, saldo: 0 },
    { id: 4, nombre: 'Nequi', tipo: 'billetera', principal: false, saldo: 0 },
  ];

  it('encuentra la cuenta mencionada', () => {
    expect(findAccount(cuentas, 'bancolombia', null)?.id).toBe(2);
    expect(findAccount(cuentas, 'la Visa', 'credito')?.id).toBe(3);
    expect(findAccount(cuentas, 'la tarjeta', null)?.id).toBe(3);
    expect(findAccount(cuentas, 'mi nequi', null)?.id).toBe(4);
    expect(findAccount(cuentas, 'efectivo', 'efectivo')?.id).toBe(1);
    expect(findAccount(cuentas, 'Davivienda', 'banco')).toBeNull();
    expect(findAccount(cuentas, 'mi cuenta', null)).toBeNull();
  });

  it('nombra y clasifica cuentas nuevas', () => {
    expect(inferKind('Daviplata')).toBe('billetera');
    expect(inferKind('tarjeta Mastercard')).toBe('credito');
    expect(inferKind('tarjeta débito')).toBe('banco');
    expect(inferKind('Cuenta de ahorros')).toBe('ahorro');
    expect(inferKind('Banco de Bogotá')).toBe('banco');
    expect(displayName('la tarjeta Master', 'credito')).toBe('Tarjeta Master');
    expect(displayName('la tarjeta', 'credito')).toBe('Tarjeta de crédito');
    expect(displayName('nequi', 'billetera')).toBe('Nequi');
  });
});

describe('salida del modelo', () => {
  it('acepta objeto, texto o formato OpenAI', () => {
    expect(parseJsonOutput({ response: { acciones: [] } })).toEqual({ acciones: [] });
    expect(parseJsonOutput({ response: 'Claro: {"acciones": []} listo' })).toEqual({ acciones: [] });
    expect(parseJsonOutput({ choices: [{ message: { content: '{"a":1}' } }] })).toEqual({ a: 1 });
    expect(parseJsonOutput({ response: 'no json' })).toBeNull();
  });

  it('descarta acciones mal formadas', () => {
    expect(
      sanitizeActions({ acciones: [{ accion: 'gasto', monto: '20000' }, { accion: 'robar', monto: 1 }, null] }),
    ).toEqual([
      { accion: 'gasto', monto: 20000, categoria: '', descripcion: '', cuenta: '', cuenta_destino: '', tipo_cuenta: '', fecha: '' },
    ]);
    expect(sanitizeActions(null)).toEqual([]);
  });
});
