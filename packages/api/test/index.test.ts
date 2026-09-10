import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

describe('@dce/api', () => {
  it('responde /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', service: '@dce/api' });
  });

  it('devuelve el mundo completo en /api/world', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/world' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hexCount).toBeGreaterThan(200);
    expect(body.countries.length).toBe(4);
    expect(body.hexes.length).toBe(body.hexCount);
  });

  it('es determinista por seed', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/world?seed=alpha-1' });
    const b = await app.inject({ method: 'GET', url: '/api/world?seed=alpha-1' });
    expect(a.json()).toEqual(b.json());
  });
});
