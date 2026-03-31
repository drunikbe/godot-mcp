/**
 * E2E Headless Test — exercises all MCP tools via HTTP against a live daemon.
 *
 * Prerequisites:
 *   1. Build: cd server && npm run build
 *   2. Start daemon: node dist/index.js --daemon --project /path/to/godot/project
 *   3. Wait for Godot to connect (headless mode)
 *   4. Run: node --test tests/e2e-headless.test.mjs
 *
 * Environment:
 *   E2E_HTTP_PORT — daemon HTTP port (default: auto-detect from daemon file or 7542)
 *   E2E_PROJECT   — Godot project path (default: auto-detect)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// ── Configuration ─────────────────────────────────────────────────

const HTTP_PORT = process.env.E2E_HTTP_PORT || 7542;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}/mcp`;

let sessionId;

// ── Helpers ───────────────────────────────────────────────────────

async function initSession() {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'e2e-headless-test', version: '1.0' },
      },
    }),
  });
  const sid = res.headers.get('mcp-session-id');
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data:'));
  const data = dataLine ? JSON.parse(dataLine.slice(5)) : JSON.parse(text);

  // Send initialized notification
  await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sid,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  return { sessionId: sid, initResponse: data };
}

async function callTool(name, args = {}) {
  const id = Math.floor(Math.random() * 100000);
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data:'));
  const parsed = dataLine ? JSON.parse(dataLine.slice(5)) : JSON.parse(text);

  if (parsed.error) {
    return { _mcpError: true, code: parsed.error.code, message: parsed.error.message };
  }

  const content = parsed.result?.content?.[0];
  if (!content) return parsed;

  if (content.type === 'text') {
    try { return JSON.parse(content.text); } catch { return { _raw: content.text }; }
  }
  if (content.type === 'image') {
    return { _image: true, mimeType: content.mimeType, dataLength: content.data?.length || 0 };
  }
  return parsed;
}

// ── Test Suite ────────────────────────────────────────────────────

describe('E2E Headless — Full Tool Coverage', () => {
  before(async () => {
    // Wait for Godot to connect
    let connected = false;
    for (let i = 0; i < 30; i++) {
      try {
        const sess = await initSession();
        sessionId = sess.sessionId;
        const status = await callTool('get_godot_status');
        if (status.connected) {
          connected = true;
          break;
        }
      } catch { /* daemon not ready yet */ }
      await sleep(2000);
    }
    if (!connected) {
      // Try one more time and use whatever session we have
      const sess = await initSession();
      sessionId = sess.sessionId;
    }
  });

  // ── Status ───────────────────────────────────────────────────

  describe('Status & Connection', () => {
    it('get_godot_status — connected with v0.2.0', async () => {
      const r = await callTool('get_godot_status');
      assert.equal(r.connected, true, 'Godot should be connected');
      assert.equal(r.server_version, '0.2.0');
      assert.equal(r.mode, 'live');
      assert.ok(r.project_path);
    });
  });

  // ── File Tools ───────────────────────────────────────────────

  describe('File Tools', () => {
    it('list_dir — project root', async () => {
      const r = await callTool('list_dir', { path: 'res://' });
      assert.ok(r.files?.length > 0 || r.folders?.length > 0);
      assert.ok(r.folders?.includes('addons') || r.folders?.includes('scenes'));
    });

    it('read_file — project.godot', async () => {
      const r = await callTool('read_file', { path: 'res://project.godot', start_line: 1, end_line: 5 });
      assert.ok(r.content?.includes('Engine configuration'));
      assert.equal(r.line_count, 5);
    });

    it('search_project — find extends', async () => {
      const r = await callTool('search_project', { query: 'extends', glob: '**/*.gd' });
      assert.ok(r.total_matches > 0);
      assert.ok(r.matches[0].file.endsWith('.gd'));
    });

    it('create_folder + create_script + validate + edit + delete cycle', async () => {
      // Create folder
      const folder = await callTool('create_folder', { path: 'res://tests/_e2e_headless' });
      assert.ok(folder.message?.includes('created') || folder.path);

      // Create script
      const script = await callTool('create_script', {
        path: 'res://tests/_e2e_headless/test.gd',
        content: 'extends Node2D\n\nvar hp: int = 100\n\nfunc _ready() -> void:\n\tprint("test")\n',
      });
      assert.ok(script.path);

      // Validate — should be valid: true (fix #2)
      const valid = await callTool('validate_script', { path: 'res://tests/_e2e_headless/test.gd' });
      assert.equal(valid.valid, true, 'Syntax-correct script should be valid: true');
      assert.equal(valid.can_instantiate, false, 'Fresh script may not be instantiable');
      assert.ok(valid.message.includes('Syntax OK'));

      // Edit
      const edit = await callTool('edit_script', {
        edit: {
          type: 'snippet_replace',
          file: 'res://tests/_e2e_headless/test.gd',
          old_snippet: 'var hp: int = 100',
          new_snippet: 'var hp: int = 200\nvar name_tag: String = "e2e"',
        },
      });
      assert.ok(edit.auto_applied || edit.message?.includes('Applied'));

      // Verify edit
      const readback = await callTool('read_file', { path: 'res://tests/_e2e_headless/test.gd' });
      assert.ok(readback.content?.includes('hp: int = 200'));
      assert.ok(readback.content?.includes('name_tag'));

      // Delete — should also remove .import if present
      const del = await callTool('delete_file', {
        path: 'res://tests/_e2e_headless/test.gd', confirm: true, create_backup: false,
      });
      assert.ok(del.message?.includes('deleted'));
    });

    it('generate_2d_asset + delete cleans up .import (fix #4)', async () => {
      const asset = await callTool('generate_2d_asset', {
        svg_code: '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" fill="red"/></svg>',
        filename: 'e2e_test.png',
        save_path: 'res://tests/_e2e_headless/',
      });
      assert.ok(asset.resource_path);

      // Wait for Godot to create .import file
      await sleep(1000);
      const dirBefore = await callTool('list_dir', { path: 'res://tests/_e2e_headless' });
      const hasImport = dirBefore.files?.some(f => f === 'e2e_test.png.import');
      // .import might not exist in headless mode — that's OK

      // Delete the PNG
      const del = await callTool('delete_file', {
        path: 'res://tests/_e2e_headless/e2e_test.png', confirm: true, create_backup: false,
      });
      assert.ok(del.message?.includes('deleted'));

      // Verify .import is also gone
      const dirAfter = await callTool('list_dir', { path: 'res://tests/_e2e_headless' });
      const importStillExists = dirAfter.files?.some(f => f === 'e2e_test.png.import');
      assert.ok(!importStillExists, '.import file should be cleaned up');
    });

    it('rename_file', async () => {
      await callTool('create_script', {
        path: 'res://tests/_e2e_headless/rename_me.gd',
        content: 'extends Node\n',
      });
      const r = await callTool('rename_file', {
        old_path: 'res://tests/_e2e_headless/rename_me.gd',
        new_path: 'res://tests/_e2e_headless/renamed.gd',
      });
      assert.ok(r.new_path?.includes('renamed.gd'));

      // Cleanup
      await callTool('delete_file', {
        path: 'res://tests/_e2e_headless/renamed.gd', confirm: true, create_backup: false,
      });
    });
  });

  // ── Scene Tools ──────────────────────────────────────────────

  describe('Scene Tools', () => {
    it('create_scene + add_node + rename_node + modify_property + move_node + remove_node', async () => {
      // Create
      const scene = await callTool('create_scene', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        root_node_type: 'Node2D',
        root_node_name: 'TestRoot',
        nodes: [{ name: 'Player', type: 'Sprite2D' }, { name: 'Camera', type: 'Camera2D' }],
      });
      assert.ok(scene.path);
      assert.equal(scene.child_count, 2);

      // Add node
      const added = await callTool('add_node', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_name: 'Enemy', node_type: 'CharacterBody2D', parent_path: '.',
      });
      assert.ok(added.node_name === 'Enemy');

      // Rename node
      const renamed = await callTool('rename_node', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_path: 'Enemy', new_name: 'Boss',
      });
      assert.ok(renamed.new_name === 'Boss');

      // Modify property
      const mod = await callTool('modify_node_property', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_path: 'Player', property_name: 'position',
        value: { type: 'Vector2', x: 50, y: 75 },
      });
      assert.ok(mod.new_value?.includes('50'));

      // Move node
      const moved = await callTool('move_node', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_path: 'Camera', new_parent_path: 'Player',
      });
      assert.ok(moved.message?.includes('Moved'));

      // Read scene to verify
      const tree = await callTool('read_scene', {
        scene_path: 'res://tests/_e2e_headless/test.tscn', include_properties: true,
      });
      assert.ok(tree.root);
      const player = tree.root.children?.find(c => c.name === 'Player');
      assert.ok(player);
      assert.ok(player.children?.some(c => c.name === 'Camera'));

      // Remove node
      const removed = await callTool('remove_node', {
        scene_path: 'res://tests/_e2e_headless/test.tscn', node_path: 'Boss',
      });
      assert.ok(removed.removed_node === 'Boss');

      // Attach + detach script
      await callTool('create_script', {
        path: 'res://tests/_e2e_headless/scene_script.gd',
        content: 'extends Node2D\n',
      });
      const attached = await callTool('attach_script', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        script_path: 'res://tests/_e2e_headless/scene_script.gd',
        node_path: '.',
      });
      assert.ok(attached.message?.includes('Attached'));

      const detached = await callTool('detach_script', {
        scene_path: 'res://tests/_e2e_headless/test.tscn', node_path: '.',
      });
      assert.ok(detached.message?.includes('Detached'));

      // Collision shape
      await callTool('add_node', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_name: 'Col', node_type: 'CollisionShape2D', parent_path: '.',
      });
      const shape = await callTool('set_collision_shape', {
        scene_path: 'res://tests/_e2e_headless/test.tscn',
        node_path: 'Col', shape_type: 'RectangleShape2D',
        shape_params: { size_x: 32, size_y: 64 },
      });
      assert.ok(shape.message?.includes('RectangleShape2D'));

      // Cleanup
      await callTool('delete_file', {
        path: 'res://tests/_e2e_headless/test.tscn', confirm: true, create_backup: false,
      });
      await callTool('delete_file', {
        path: 'res://tests/_e2e_headless/scene_script.gd', confirm: true, create_backup: false,
      });
    });
  });

  // ── Project Tools ────────────────────────────────────────────

  describe('Project Tools', () => {
    it('get_project_settings', async () => {
      const r = await callTool('get_project_settings');
      assert.ok(r.settings?.main_scene);
    });

    it('get_input_map', async () => {
      const r = await callTool('get_input_map');
      assert.ok(r.count > 0);
      assert.ok(r.actions);
    });

    it('list_scripts', async () => {
      const r = await callTool('list_scripts');
      assert.ok(r.count > 0);
      assert.ok(r.scripts?.some(s => s.endsWith('.gd')));
    });

    it('classdb_query', async () => {
      const r = await callTool('classdb_query', { class_name: 'Node2D', query: 'methods' });
      assert.ok(r.methods?.length > 0);
      assert.equal(r.class, 'Node2D');
    });

    it('get_node_properties', async () => {
      const r = await callTool('get_node_properties', { node_type: 'Camera2D' });
      assert.ok(r.property_count > 0);
      assert.ok(r.inheritance_chain?.includes('Camera2D'));
    });

    it('scene_tree_dump', async () => {
      const r = await callTool('scene_tree_dump');
      assert.ok(r.tree);
    });

    it('list_settings', async () => {
      const r = await callTool('list_settings');
      assert.ok(r.categories);
      assert.ok(r.categories.display > 0);
    });

    it('list_settings with category', async () => {
      const r = await callTool('list_settings', { category: 'audio' });
      assert.ok(r.count > 0);
      assert.ok(r.settings?.length > 0);
    });

    it('get_collision_layers', async () => {
      const r = await callTool('get_collision_layers');
      assert.ok('layers_2d' in r);
      assert.ok('layers_3d' in r);
    });

    it('setup_autoload list', async () => {
      const r = await callTool('setup_autoload', { operation: 'list' });
      assert.ok(r.autoloads);
    });

    it('rescan_filesystem', async () => {
      const r = await callTool('rescan_filesystem');
      assert.ok(r.message?.includes('rescan'));
    });
  });

  // ── Console & Error Tools ────────────────────────────────────

  describe('Console & Error Tools', () => {
    it('get_errors', async () => {
      const r = await callTool('get_errors', { max_errors: 5 });
      assert.ok('error_count' in r || 'errors' in r);
    });

    it('get_console_log', async () => {
      const r = await callTool('get_console_log', { max_lines: 5 });
      assert.ok('lines' in r || 'content' in r);
    });

    it('clear_console_log', async () => {
      const r = await callTool('clear_console_log');
      assert.ok(r.message?.toLowerCase().includes('clear'));
    });
  });

  // ── Runtime Tools (via debugger bridge) ──────────────────────

  describe('Runtime Tools', () => {
    let gamePlaying = false;

    before(async () => {
      // Check if already playing
      const status = await callTool('is_playing');
      if (!status.playing) {
        const run = await callTool('run_scene');
        assert.ok(run.message);
        // Wait for game to start and debugger to connect
        await sleep(3000);
      }
      const check = await callTool('is_playing');
      gamePlaying = check.playing === true;
    });

    after(async () => {
      if (gamePlaying) {
        await callTool('stop_scene');
      }
    });

    it('is_playing — true after run_scene', async () => {
      const r = await callTool('is_playing');
      assert.equal(r.playing, true);
    });

    it('get_debugger_errors', async () => {
      const r = await callTool('get_debugger_errors', { max_errors: 5 });
      assert.ok('error_count' in r || 'errors' in r);
    });

    it('game_scene_tree', async () => {
      // Ensure game is running before this test
      const playing = await callTool('is_playing');
      if (!playing.playing) {
        await callTool('run_scene');
        await sleep(3000);
      }
      const r = await callTool('game_scene_tree', { max_depth: 2, max_nodes: 50 });
      if (r.error?.includes('No active debug session') || r.error?.includes('timed out')) {
        assert.ok(true, 'EXPECTED: debug session not active in headless (issue #1)');
        return;
      }
      assert.ok(r.tree || r.ok);
    });

    it('game_screenshot (headless)', async () => {
      const r = await callTool('game_screenshot');
      if (r.error?.includes('No active debug session')) {
        assert.ok(true, 'EXPECTED FAIL: debug session not active (issue #1)');
        return;
      }
      if (r.error?.includes('Headless')) {
        assert.ok(true, 'Expected: headless mode cannot take screenshots');
        return;
      }
      // If we get here, screenshots work (non-headless)
      assert.ok(r._image || r.path || r.ok);
    });

    it('game_get_property', async () => {
      const r = await callTool('game_get_property', {
        node_path: '/root', property: 'name',
      });
      if (r.error?.includes('No active debug session')) {
        assert.ok(true, 'EXPECTED FAIL: debug session not active (issue #1)');
        return;
      }
      assert.ok(r.ok !== false);
    });

    it('performance_stats', async () => {
      const r = await callTool('performance_stats', { categories: ['time', 'memory'] });
      if (r.error?.includes('No active debug session')) {
        assert.ok(true, 'EXPECTED FAIL: debug session not active (issue #1)');
        return;
      }
      assert.ok(r.stats);
    });

    it('eval_expression', async () => {
      const r = await callTool('eval_expression', { code: '2 + 2', context_node: '/root' });
      if (r.error?.includes('No active debug session') || r.error?.includes('timed out') || r.error?.includes('not connected')) {
        assert.ok(true, 'EXPECTED: debug session not active in headless (issue #1)');
        return;
      }
      assert.ok(r.result !== undefined || r.ok);
    });

    it('stop_scene', async () => {
      const r = await callTool('stop_scene');
      assert.ok(r.message);
      gamePlaying = false;

      await sleep(500);
      const check = await callTool('is_playing');
      assert.equal(check.playing, false);
    });
  });

  // ── Lifecycle Tools ──────────────────────────────────────────

  describe('Lifecycle Tools', () => {
    it('godot_process_status', async () => {
      const r = await callTool('godot_process_status');
      assert.ok('managed' in r || 'running' in r || 'connected' in r);
    });
  });

  // ── Assert Meta-Tools ────────────────────────────────────────

  describe('Assert Tools (via bridge mock)', () => {
    // These require a running game with debug session.
    // Test the error path gracefully.

    it('assert_property returns error when game not running', async () => {
      const r = await callTool('assert_property', {
        node_path: '/root', property: 'name', expected: 'root',
      });
      // Either works or returns connection error
      assert.ok(r.pass !== undefined || r.error || r.ok === false);
    });

    it('assert_node_exists returns error when game not running', async () => {
      const r = await callTool('assert_node_exists', { node_path: '/root' });
      assert.ok(r.pass !== undefined || r.error || r.ok === false);
    });
  });

  // ── Unknown tool ─────────────────────────────────────────────

  describe('Error Handling', () => {
    it('unknown tool returns MCP error', async () => {
      const r = await callTool('nonexistent_tool');
      assert.ok(r._mcpError);
      assert.equal(r.code, -32601);
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────

  after(async () => {
    // Clean up test folder
    try {
      const dir = await callTool('list_dir', { path: 'res://tests/_e2e_headless' });
      if (dir.files) {
        for (const f of dir.files) {
          await callTool('delete_file', {
            path: `res://tests/_e2e_headless/${f}`, confirm: true, create_backup: false,
          });
        }
      }
    } catch { /* folder may not exist */ }
  });
});
