import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type AppContext } from '../src/index';

let ctx: AppContext;

beforeEach(async () => {
  ctx = await buildApp({ tick: false });
});

afterEach(async () => {
  await ctx.app.close();
});

describe('@dce/api — servicio base', () => {
  it('responde /health', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: '@dce/api' });
  });

  it('devuelve el mundo completo en /api/world', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/world' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hexCount).toBeGreaterThan(200);
    expect(body.countries.length).toBe(4);
    expect(body.hexes.length).toBe(body.hexCount);
  });

  it('es determinista por seed', async () => {
    const a = await ctx.app.inject({ method: 'GET', url: '/api/world?seed=alpha-1' });
    const b = await ctx.app.inject({ method: 'GET', url: '/api/world?seed=alpha-1' });
    expect(a.json()).toEqual(b.json());
  });

  it('expone el estado del Tick en /api/status', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/status' });
    const body = res.json();
    expect(body.tickSeconds).toBeGreaterThan(0);
    expect(body.countries).toBe(4);
    expect(body.hexCount).toBeGreaterThan(200);
  });
});
