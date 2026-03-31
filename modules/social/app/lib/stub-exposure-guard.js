// =============================================================================
// Experimental stub endpoint exposure (WO-PMDL-2026-03-31-224)
// =============================================================================
// Selected Phase-1 JSON stubs can be hidden in stricter deployments via env.
// Default: unrestricted (backward compatible with existing smoke and baselines).

const TRUTHY = new Set(['1', 'true', 'yes']);

/**
 * When true, guarded routes respond with 403 + experimental_stub_disabled
 * instead of stub JSON payloads.
 */
export function isExperimentalStubExposureRestricted() {
  const v = (process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS || '').trim().toLowerCase();
  return TRUTHY.has(v);
}

/**
 * If restriction is enabled, sends JSON 403 and returns true (handler should stop).
 * @param {import('node:http').ServerResponse} res
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} jsonFn
 * @returns {boolean}
 */
export function denyExperimentalStubIfRestricted(res, jsonFn) {
  if (!isExperimentalStubExposureRestricted()) return false;
  jsonFn(res, 403, {
    error: 'Forbidden',
    code: 'experimental_stub_disabled',
    message:
      'Experimental stub endpoint disabled (SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS).',
  });
  return true;
}
