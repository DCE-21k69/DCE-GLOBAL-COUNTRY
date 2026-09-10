import { describe, expect, it } from 'vitest';
import { formatCountdown, formatNumber } from '../src/ui';

describe('utilidades de UI', () => {
  it('formatea números grandes', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(42_000)).toBe('42.0K');
    expect(formatNumber(3_100_000)).toBe('3.1M');
    expect(formatNumber(2_000_000_000)).toBe('2.0B');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('formatea el temporizador del tick', () => {
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(65)).toBe('00:01:05');
    expect(formatCountdown(3661)).toBe('01:01:01');
    expect(formatCountdown(-5)).toBe('00:00:00');
  });
});
