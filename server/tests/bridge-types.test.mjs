/**
 * Bridge types smoke test.
 *
 * TypeScript types are erased at compile time, so this just verifies
 * that the compiled module can be imported without errors.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Bridge types module', () => {
  it('can be imported without errors', async () => {
    // Types are erased at runtime — the module should still load cleanly
    const mod = await import('../dist/bridge/types.js');
    assert.ok(mod !== null && mod !== undefined, 'module imported');
  });
});
