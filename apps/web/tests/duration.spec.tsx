import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../app/lib/duration';

describe('formatMinutes', () => {
  it('shows fractional minutes as minutes and seconds, never as a decimal', () => {
    expect(formatMinutes(3.89)).toBe('3m 53s'); // not "3.89", which reads as almost 4
    expect(formatMinutes(3.1)).toBe('3m 06s');
    expect(formatMinutes(4)).toBe('4m 00s');
    expect(formatMinutes(0.5)).toBe('30s');
  });

  it('uses hours for long totals and drops seconds from 100h', () => {
    expect(formatMinutes(125.5)).toBe('2h 05m 30s');
    expect(formatMinutes(12_000.2)).toBe('200h 00m');
  });

  it('treats missing or invalid values as zero', () => {
    expect(formatMinutes(0)).toBe('0s');
    expect(formatMinutes(undefined)).toBe('0s');
    expect(formatMinutes(Number.NaN)).toBe('0s');
    expect(formatMinutes(-2)).toBe('0s');
  });
});
