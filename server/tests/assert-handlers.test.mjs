/**
 * Assert tool handler tests.
 *
 * Tests the behavioral logic of handleAssertTool: comparison operators,
 * type coercion, node existence checks, and the wait_for_condition poll loop.
 * Uses a mock bridge to avoid requiring a live Godot connection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleAssertTool } from '../dist/tools/assert-tools.js';

/**
 * Create a mock bridge that returns a canned value for game_get_property.
 * @param {unknown} value — the value to return
 * @param {boolean} ok — whether the call succeeds
 */
function mockBridge(value, ok = true) {
  return {
    isConnected: () => true,
    invokeTool: async (toolName, args) => {
      if (ok) return { ok: true, value };
      return { ok: false, error: 'Node not found' };
    },
  };
}

/** Bridge that fails with an exception */
function throwingBridge(msg = 'Node does not exist') {
  return {
    isConnected: () => true,
    invokeTool: async () => { throw new Error(msg); },
  };
}

// ── assert_property ──────────────────────────────────────────────

describe('assert_property', () => {
  it('passes for equal numbers within tolerance', async () => {
    const bridge = mockBridge(100.00005);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'eq',
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.comparator, 'eq');
  });

  it('fails for numbers outside tolerance', async () => {
    const bridge = mockBridge(105);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'eq',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('supports custom tolerance', async () => {
    const bridge = mockBridge(100.5);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'eq',
      tolerance: 1.0,
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('neq comparator works for different numbers', async () => {
    const bridge = mockBridge(50);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'neq',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('neq fails for equal numbers within tolerance', async () => {
    const bridge = mockBridge(100.00001);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'neq',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('gt comparator', async () => {
    const bridge = mockBridge(150);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'gt',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('gt fails when equal', async () => {
    const bridge = mockBridge(100);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'gt',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('lt comparator', async () => {
    const bridge = mockBridge(50);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'lt',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('gte comparator (equal case)', async () => {
    const bridge = mockBridge(100);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'gte',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('lte comparator (less case)', async () => {
    const bridge = mockBridge(50);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'health',
      expected: '100',
      comparator: 'lte',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('contains comparator for strings', async () => {
    const bridge = mockBridge('Hello World');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/UI/Label',
      property: 'text',
      expected: 'World',
      comparator: 'contains',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('contains fails when substring not present', async () => {
    const bridge = mockBridge('Hello World');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/UI/Label',
      property: 'text',
      expected: 'Goodbye',
      comparator: 'contains',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('matches_regex comparator', async () => {
    const bridge = mockBridge('Player_001');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'name',
      expected: 'Player_\\d+',
      comparator: 'matches_regex',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('matches_regex fails for non-matching pattern', async () => {
    const bridge = mockBridge('Enemy_001');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'name',
      expected: '^Player',
      comparator: 'matches_regex',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('matches_regex returns false for invalid regex', async () => {
    const bridge = mockBridge('test');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'name',
      expected: '[invalid',
      comparator: 'matches_regex',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('eq for boolean values', async () => {
    const bridge = mockBridge(true);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'visible',
      expected: 'true',
      comparator: 'eq',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('eq fails for wrong boolean', async () => {
    const bridge = mockBridge(false);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'visible',
      expected: 'true',
      comparator: 'eq',
    }, bridge, 30000);
    assert.equal(result.pass, false);
  });

  it('eq for string values', async () => {
    const bridge = mockBridge('idle');
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'state',
      expected: 'idle',
      comparator: 'eq',
    }, bridge, 30000);
    assert.equal(result.pass, true);
  });

  it('returns pass: false with error when bridge returns error', async () => {
    const bridge = mockBridge(null, false);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Missing',
      property: 'health',
      expected: '100',
    }, bridge, 30000);
    assert.equal(result.pass, false);
    assert.ok(result.error);
  });

  it('default comparator is eq', async () => {
    const bridge = mockBridge(42);
    const result = await handleAssertTool('assert_property', {
      node_path: '/root/Player',
      property: 'speed',
      expected: '42',
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.comparator, 'eq');
  });

  it('result includes message with PASS/FAIL prefix', async () => {
    const bridge = mockBridge(100);
    const pass = await handleAssertTool('assert_property', {
      node_path: '/root/P', property: 'hp', expected: '100',
    }, bridge, 30000);
    assert.ok(pass.message.startsWith('PASS:'));

    const bridge2 = mockBridge(50);
    const fail = await handleAssertTool('assert_property', {
      node_path: '/root/P', property: 'hp', expected: '100',
    }, bridge2, 30000);
    assert.ok(fail.message.startsWith('FAIL:'));
  });
});

// ── assert_node_exists ───────────────────────────────────────────

describe('assert_node_exists', () => {
  it('passes when node exists and should_exist is true', async () => {
    const bridge = mockBridge('Player');
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Player',
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.exists, true);
  });

  it('passes when node does not exist and should_exist is false', async () => {
    const bridge = throwingBridge();
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Missing',
      should_exist: false,
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.exists, false);
  });

  it('fails when node exists but should_exist is false', async () => {
    const bridge = mockBridge('Enemy');
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Enemy',
      should_exist: false,
    }, bridge, 30000);
    assert.equal(result.pass, false);
    assert.equal(result.exists, true);
  });

  it('fails when node does not exist but should_exist is true', async () => {
    const bridge = throwingBridge();
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Missing',
      should_exist: true,
    }, bridge, 30000);
    assert.equal(result.pass, false);
    assert.equal(result.exists, false);
  });

  it('default should_exist is true', async () => {
    const bridge = mockBridge('Node');
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Node',
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.should_exist, true);
  });

  it('handles bridge returning ok:false as non-existent', async () => {
    const bridge = mockBridge(null, false);
    const result = await handleAssertTool('assert_node_exists', {
      node_path: '/root/Gone',
      should_exist: false,
    }, bridge, 30000);
    assert.equal(result.pass, true);
    assert.equal(result.exists, false);
  });
});

// ── wait_for_condition ───────────────────────────────────────────

describe('wait_for_condition', () => {
  it('resolves immediately when condition is already met', async () => {
    const bridge = mockBridge(100);
    const result = await handleAssertTool('wait_for_condition', {
      node_path: '/root/Player',
      property: 'health',
      condition: 'eq',
      value: '100',
      timeout_sec: 1,
      poll_interval_sec: 0.05,
    }, bridge, 30000);
    assert.equal(result.met, true);
    assert.ok(result.elapsed_sec < 0.5, 'should resolve quickly');
  });

  it('times out when condition is never met', async () => {
    const bridge = mockBridge(0);
    const result = await handleAssertTool('wait_for_condition', {
      node_path: '/root/Player',
      property: 'health',
      condition: 'gt',
      value: '50',
      timeout_sec: 0.3,
      poll_interval_sec: 0.05,
    }, bridge, 30000);
    assert.equal(result.met, false);
    assert.ok(result.elapsed_sec >= 0.2, 'should have waited');
    assert.ok(result.message.includes('Timeout'));
  });

  it('meets condition after a few polls', async () => {
    let callCount = 0;
    const bridge = {
      isConnected: () => true,
      invokeTool: async () => {
        callCount++;
        return { ok: true, value: callCount >= 3 ? 100 : 0 };
      },
    };
    const result = await handleAssertTool('wait_for_condition', {
      node_path: '/root/Player',
      property: 'health',
      condition: 'gte',
      value: '100',
      timeout_sec: 5,
      poll_interval_sec: 0.05,
    }, bridge, 30000);
    assert.equal(result.met, true);
    assert.ok(callCount >= 3);
  });

  it('caps timeout to (toolTimeoutMs / 1000 - 5)', async () => {
    // toolTimeoutMs = 10000 => max = 5s, requested = 60s => should cap to 5s
    const bridge = mockBridge(0);
    const start = Date.now();
    const result = await handleAssertTool('wait_for_condition', {
      node_path: '/root/P',
      property: 'hp',
      condition: 'eq',
      value: '999',
      timeout_sec: 60,
      poll_interval_sec: 0.05,
    }, bridge, 10000);
    const elapsed = (Date.now() - start) / 1000;
    assert.equal(result.met, false);
    // Should timeout around 5s, not 60s
    assert.ok(elapsed < 10, `Elapsed ${elapsed}s should be < 10s`);
  });

  it('handles throwing bridge by continuing to poll', async () => {
    let callCount = 0;
    const bridge = {
      isConnected: () => true,
      invokeTool: async () => {
        callCount++;
        if (callCount < 3) throw new Error('Node not ready');
        return { ok: true, value: 42 };
      },
    };
    const result = await handleAssertTool('wait_for_condition', {
      node_path: '/root/P',
      property: 'val',
      condition: 'eq',
      value: '42',
      timeout_sec: 5,
      poll_interval_sec: 0.05,
    }, bridge, 30000);
    assert.equal(result.met, true);
  });
});

// ── unknown tool ─────────────────────────────────────────────────

describe('handleAssertTool unknown', () => {
  it('returns error for unknown assert tool name', async () => {
    const result = await handleAssertTool('assert_color', {}, null, 30000);
    assert.deepEqual(result, { ok: false, error: 'Unknown assert tool: assert_color' });
  });
});
