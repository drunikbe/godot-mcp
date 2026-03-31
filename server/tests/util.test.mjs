/**
 * Utility function tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toErrorMessage } from '../dist/util.js';

describe('toErrorMessage', () => {
  it('extracts message from Error instance', () => {
    assert.equal(toErrorMessage(new Error('test error')), 'test error');
  });

  it('extracts message from TypeError', () => {
    assert.equal(toErrorMessage(new TypeError('type issue')), 'type issue');
  });

  it('converts string to itself', () => {
    assert.equal(toErrorMessage('plain string'), 'plain string');
  });

  it('converts number to string', () => {
    assert.equal(toErrorMessage(42), '42');
  });

  it('converts null to "null"', () => {
    assert.equal(toErrorMessage(null), 'null');
  });

  it('converts undefined to "undefined"', () => {
    assert.equal(toErrorMessage(undefined), 'undefined');
  });

  it('converts object to string representation', () => {
    const result = toErrorMessage({ code: 500 });
    assert.equal(result, '[object Object]');
  });
});
