import { describe, expect, it } from 'vitest';
import { isMarqueeItemActive } from '@dtrace/shared';

const now = new Date('2026-09-22T12:00:00.000Z');

describe('isMarqueeItemActive', () => {
  it('shows an item with no bounds', () => {
    expect(isMarqueeItemActive({ startsAt: null, endsAt: null }, now)).toBe(true);
  });

  it('hides an item that has not started', () => {
    expect(
      isMarqueeItemActive({ startsAt: '2026-09-23T00:00:00.000Z', endsAt: null }, now),
    ).toBe(false);
  });

  it('hides an item that has ended', () => {
    expect(
      isMarqueeItemActive({ startsAt: null, endsAt: '2026-09-22T11:59:59.000Z' }, now),
    ).toBe(false);
  });

  it('shows an item inside its window', () => {
    expect(
      isMarqueeItemActive(
        { startsAt: '2026-09-18T13:12:00.000Z', endsAt: '2026-09-30T13:12:00.000Z' },
        now,
      ),
    ).toBe(true);
  });

  it('treats the end instant as exclusive', () => {
    // An item that ends "at 12:00" should not still be on screen at 12:00.
    expect(
      isMarqueeItemActive({ startsAt: null, endsAt: '2026-09-22T12:00:00.000Z' }, now),
    ).toBe(false);
  });

  it('treats the start instant as inclusive', () => {
    expect(
      isMarqueeItemActive({ startsAt: '2026-09-22T12:00:00.000Z', endsAt: null }, now),
    ).toBe(true);
  });
});
