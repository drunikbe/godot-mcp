/**
 * Assert tool definitions and handler tests.
 *
 * Tests the exported surface of assert-tools: tool count, schemas,
 * and handleAssertTool behavior for unknown tool names.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertTools, assertToolNames, handleAssertTool } from '../dist/tools/assert-tools.js';

describe('Assert tools', () => {
  it('assertToolNames has exactly 3 entries', () => {
    assert.equal(assertToolNames.size, 3);
  });

  it('assertToolNames matches assertTools names', () => {
    const namesFromArray = new Set(assertTools.map(t => t.name));
    assert.deepEqual(assertToolNames, namesFromArray);
  });

  it('contains assert_property, assert_node_exists, wait_for_condition', () => {
    assert.ok(assertToolNames.has('assert_property'));
    assert.ok(assertToolNames.has('assert_node_exists'));
    assert.ok(assertToolNames.has('wait_for_condition'));
  });

  it('assert_property schema has node_path, property, expected as required', () => {
    const tool = assertTools.find(t => t.name === 'assert_property');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['node_path', 'property', 'expected']);
    assert.ok('comparator' in tool.inputSchema.properties);
    assert.ok('tolerance' in tool.inputSchema.properties);
  });

  it('wait_for_condition schema has condition and value as required', () => {
    const tool = assertTools.find(t => t.name === 'wait_for_condition');
    assert.ok(tool);
    assert.ok(tool.inputSchema.required.includes('condition'));
    assert.ok(tool.inputSchema.required.includes('value'));
    assert.ok('timeout_sec' in tool.inputSchema.properties);
    assert.ok('poll_interval_sec' in tool.inputSchema.properties);
  });

  it('assert_node_exists schema has node_path required', () => {
    const tool = assertTools.find(t => t.name === 'assert_node_exists');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['node_path']);
    assert.ok('should_exist' in tool.inputSchema.properties);
  });

  it('handleAssertTool returns error for unknown tool name', async () => {
    // No bridge needed — it should short-circuit before using it
    const result = await handleAssertTool('unknown_assert', {}, /** @type {any} */ (null), 30000);
    assert.deepEqual(result, { ok: false, error: 'Unknown assert tool: unknown_assert' });
  });
});
