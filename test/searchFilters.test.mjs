import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasMeaningfulUpdateSince, parseMaxDaysSinceUpdated } from '../src/lib/searchFilters.js';

describe('search date filters', () => {
  it('parses positive maxDaysSinceUpdated values', () => {
    const now = Date.parse('2026-05-01T00:00:00.000Z');
    const { cutoffMs, error } = parseMaxDaysSinceUpdated(7, now);

    assert.equal(error, null);
    assert.equal(new Date(cutoffMs).toISOString(), '2026-04-24T00:00:00.000Z');
  });

  it('rejects invalid maxDaysSinceUpdated values', () => {
    assert.equal(parseMaxDaysSinceUpdated(0).error, 'maxDaysSinceUpdated must be a positive number');
    assert.equal(parseMaxDaysSinceUpdated('abc').error, 'maxDaysSinceUpdated must be a positive number');
  });

  it('includes undated docs when cutoff is present', () => {
    const cutoff = Date.parse('2026-04-01T00:00:00.000Z');

    assert.equal(hasMeaningfulUpdateSince({ meaningfulUpdatedAt: '2026-04-02T00:00:00.000Z' }, cutoff), true);
    assert.equal(hasMeaningfulUpdateSince({ meaningfulUpdatedAt: '2026-03-31T23:59:59.000Z' }, cutoff), false);
    assert.equal(hasMeaningfulUpdateSince({}, cutoff), true);
  });
});
