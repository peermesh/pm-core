import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExperimentalStubExposureRestricted,
  denyExperimentalStubIfRestricted,
} from '../lib/stub-exposure-guard.js';

function setRestrict(value) {
  if (value === undefined) delete process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS;
  else process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS = value;
}

afterEach(() => {
  delete process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS;
});

describe('isExperimentalStubExposureRestricted', () => {
  test('default unset is open (backward compatible)', () => {
    delete process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS;
    assert.equal(isExperimentalStubExposureRestricted(), false);
  });

  test('empty and falsey strings are open', () => {
    for (const v of ['', '0', 'false', 'no', '  ', 'TRUEE']) {
      setRestrict(v);
      assert.equal(
        isExperimentalStubExposureRestricted(),
        false,
        `expected open for ${JSON.stringify(v)}`
      );
    }
  });

  test('1 true yes (case-insensitive) enable restriction', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
      setRestrict(v);
      assert.equal(isExperimentalStubExposureRestricted(), true, `restricted for ${v}`);
    }
  });
});

describe('denyExperimentalStubIfRestricted', () => {
  test('open: no response, returns false', () => {
    delete process.env.SOCIAL_LAB_RESTRICT_EXPERIMENTAL_STUBS;
    const calls = [];
    const res = {};
    const json = (r, code, body) => calls.push({ r, code, body });
    const denied = denyExperimentalStubIfRestricted(res, json);
    assert.equal(denied, false);
    assert.equal(calls.length, 0);
  });

  test('restricted: sends 403 payload, returns true', () => {
    setRestrict('1');
    const calls = [];
    const res = {};
    const json = (r, code, body) => calls.push({ r, code, body });
    const denied = denyExperimentalStubIfRestricted(res, json);
    assert.equal(denied, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].code, 403);
    assert.equal(calls[0].body.code, 'experimental_stub_disabled');
    assert.equal(calls[0].body.error, 'Forbidden');
  });
});
