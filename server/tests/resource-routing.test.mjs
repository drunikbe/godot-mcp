/**
 * Resource URI routing tests.
 *
 * Tests readResource with a mock bridge to verify all static routes
 * and template routes correctly map to the right tool calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readResource } from '../dist/resources/index.js';

/**
 * Create a mock bridge that records invokeTool calls and returns canned results.
 */
function createRecordingBridge() {
  const calls = [];
  const bridge = {
    isConnected: () => true,
    invokeTool: async (toolName, args) => {
      calls.push({ toolName, args });
      return { ok: true, tool: toolName, args };
    },
  };
  return { bridge, calls };
}

function disconnectedBridge() {
  return { isConnected: () => false };
}

describe('readResource routing', () => {
  // ── Static routes ────────────────────────────────────────────

  it('godot://project/settings routes to get_project_settings', async () => {
    const { bridge, calls } = createRecordingBridge();
    const result = await readResource('godot://project/settings', bridge);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolName, 'get_project_settings');
    assert.equal(result.mimeType, 'application/json');
    assert.ok(typeof result.content === 'string');
  });

  it('godot://project/input-map routes to get_input_map', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://project/input-map', bridge);
    assert.equal(calls[0].toolName, 'get_input_map');
  });

  it('godot://scenes routes to list_dir with tscn filter', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://scenes', bridge);
    assert.equal(calls[0].toolName, 'list_dir');
    assert.equal(calls[0].args.filter, '*.tscn');
    assert.equal(calls[0].args.recursive, true);
  });

  it('godot://scripts routes to list_scripts', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://scripts', bridge);
    assert.equal(calls[0].toolName, 'list_scripts');
  });

  it('godot://editor/scene-tree routes to scene_tree_dump', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://editor/scene-tree', bridge);
    assert.equal(calls[0].toolName, 'scene_tree_dump');
  });

  it('godot://editor/errors routes to get_errors', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://editor/errors', bridge);
    assert.equal(calls[0].toolName, 'get_errors');
  });

  it('godot://editor/console routes to get_console_log', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://editor/console', bridge);
    assert.equal(calls[0].toolName, 'get_console_log');
  });

  // ── Template routes ──────────────────────────────────────────

  it('godot://scene/res://main.tscn routes to read_scene', async () => {
    const { bridge, calls } = createRecordingBridge();
    const result = await readResource('godot://scene/res://main.tscn', bridge);
    assert.equal(calls[0].toolName, 'read_scene');
    assert.equal(calls[0].args.scene_path, 'res://main.tscn');
    assert.equal(result.mimeType, 'application/json');
  });

  it('godot://scene/res://scenes/level/boss.tscn routes correctly', async () => {
    const { bridge, calls } = createRecordingBridge();
    await readResource('godot://scene/res://scenes/level/boss.tscn', bridge);
    assert.equal(calls[0].args.scene_path, 'res://scenes/level/boss.tscn');
  });

  it('godot://file/res://scripts/player.gd routes to read_file', async () => {
    const { bridge, calls } = createRecordingBridge();
    const result = await readResource('godot://file/res://scripts/player.gd', bridge);
    assert.equal(calls[0].toolName, 'read_file');
    assert.equal(calls[0].args.path, 'res://scripts/player.gd');
    assert.equal(result.mimeType, 'text/plain');
  });

  // ── Error cases ──────────────────────────────────────────────

  it('throws for unknown URI', async () => {
    const { bridge } = createRecordingBridge();
    await assert.rejects(
      () => readResource('godot://nonexistent/thing', bridge),
      { message: /Unknown resource URI/ }
    );
  });

  it('throws when bridge is disconnected', async () => {
    await assert.rejects(
      () => readResource('godot://project/settings', disconnectedBridge()),
      { message: /not connected/ }
    );
  });

  // ── Content format ───────────────────────────────────────────

  it('returns JSON-stringified content', async () => {
    const { bridge } = createRecordingBridge();
    const result = await readResource('godot://project/settings', bridge);
    // Should be valid JSON
    assert.doesNotThrow(() => JSON.parse(result.content));
    // Should be pretty-printed
    assert.ok(result.content.includes('\n'));
  });
});
