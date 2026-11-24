import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RISK_SETTINGS_PATH,
  getRiskAvailability,
  isRiskSource,
  riskDependentControl,
} from '../admin/src/utils/riskData.mjs';

test('risk availability is read from the GeoIP status and never guessed', () => {
  assert.deepEqual(getRiskAvailability(null), { state: 'unknown', source: null });
  assert.deepEqual(getRiskAvailability({ exists: true }), { state: 'unknown', source: null });
  assert.deepEqual(getRiskAvailability({ risk: { available: false, source: null } }), {
    state: 'missing',
    source: null,
  });
  assert.deepEqual(getRiskAvailability({ risk: { available: true, source: 'anonymous-ip' } }), {
    state: 'available',
    source: 'anonymous-ip',
  });
  // "available" with an unknown source is not trusted.
  assert.deepEqual(getRiskAvailability({ risk: { available: true, source: 'ipapi' } }), {
    state: 'missing',
    source: null,
  });
  assert.equal(isRiskSource('asn-heuristic'), true);
  assert.equal(isRiskSource('local-mmdb'), false);
  assert.match(RISK_SETTINGS_PATH, /tab=location-data$/);
});

test('risk-dependent controls: off and disabled without a source, saved value reported', () => {
  assert.deepEqual(riskDependentControl(true, 'missing'), {
    checked: false,
    disabled: true,
    savedOnButInactive: true,
  });
  assert.deepEqual(riskDependentControl(false, 'missing'), {
    checked: false,
    disabled: true,
    savedOnButInactive: false,
  });
  assert.deepEqual(riskDependentControl(true, 'available'), {
    checked: true,
    disabled: false,
    savedOnButInactive: false,
  });
  // While the status is unknown the control keeps the saved value and stays usable.
  assert.deepEqual(riskDependentControl(true, 'unknown'), {
    checked: true,
    disabled: false,
    savedOnButInactive: false,
  });
});
