const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseMaxDaysSinceUpdated(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return { cutoffMs: null, error: null };
  }

  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) {
    return { cutoffMs: null, error: 'maxDaysSinceUpdated must be a positive number' };
  }

  return {
    cutoffMs: now - (days * MS_PER_DAY),
    error: null,
  };
}

export function hasMeaningfulUpdateSince(doc, cutoffMs) {
  if (cutoffMs === null) return true;
  if (!doc?.meaningfulUpdatedAt) return true;

  const updatedMs = Date.parse(doc.meaningfulUpdatedAt);
  return Number.isFinite(updatedMs) && updatedMs >= cutoffMs;
}
