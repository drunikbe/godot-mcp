/**
 * Tool registry and definition tests.
 *
 * Validates the central tool index: correct count, no duplicates,
 * schema invariants, and category coverage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allTools, toolExists } from '../dist/tools/index.js';
import { fileTools } from '../dist/tools/file-tools.js';
import { sceneTools } from '../dist/tools/scene-tools.js';
import { scriptTools } from '../dist/tools/script-tools.js';
import { projectTools } from '../dist/tools/project-tools.js';
import { assetTools } from '../dist/tools/asset-tools.js';
import { runtimeTools } from '../dist/tools/runtime-tools.js';
import { visualizerTools } from '../dist/tools/visualizer-tools.js';
import { lifecycleTools } from '../dist/tools/lifecycle-tools.js';
import { assertTools } from '../dist/tools/assert-tools.js';

describe('Tool registry', () => {
  it('allTools contains the expected total count', () => {
    const expected =
      fileTools.length +
      sceneTools.length +
      scriptTools.length +
      projectTools.length +
      assetTools.length +
      runtimeTools.length +
      visualizerTools.length +
      lifecycleTools.length +
      assertTools.length;
    assert.equal(allTools.length, expected, `sum of modules (${expected}) != allTools (${allTools.length})`);
  });

  it('has no duplicate tool names', () => {
    const names = allTools.map(t => t.name);
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `Duplicates: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  });

  it('toolExists returns true for known tools', () => {
    assert.ok(toolExists('list_dir'));
    assert.ok(toolExists('create_scene'));
    assert.ok(toolExists('assert_property'));
    assert.ok(toolExists('start_godot'));
  });

  it('toolExists returns false for unknown tools', () => {
    assert.equal(toolExists('nonexistent_tool'), false);
    assert.equal(toolExists(''), false);
  });

  it('every tool has name, description, and valid inputSchema', () => {
    for (const tool of allTools) {
      assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `tool missing name`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema.type != 'object'`);
      assert.ok(
        typeof tool.inputSchema.properties === 'object' && tool.inputSchema.properties !== null,
        `${tool.name} missing inputSchema.properties`
      );
    }
  });

  it('every tool required fields are a subset of its properties', () => {
    for (const tool of allTools) {
      const propKeys = Object.keys(tool.inputSchema.properties);
      const required = tool.inputSchema.required || [];
      for (const req of required) {
        assert.ok(
          propKeys.includes(req),
          `${tool.name}: required field "${req}" not in properties [${propKeys}]`
        );
      }
    }
  });

  it('category arrays cover expected tool families', () => {
    // Verify each module exports at least one tool and known names exist
    const families = [
      { name: 'file', tools: fileTools, sample: 'list_dir' },
      { name: 'scene', tools: sceneTools, sample: 'create_scene' },
      { name: 'script', tools: scriptTools, sample: 'edit_script' },
      { name: 'project', tools: projectTools, sample: 'get_project_settings' },
      { name: 'asset', tools: assetTools, sample: 'generate_2d_asset' },
      { name: 'runtime', tools: runtimeTools, sample: 'game_screenshot' },
      { name: 'visualizer', tools: visualizerTools, sample: 'debug_draw_overlay' },
      { name: 'lifecycle', tools: lifecycleTools, sample: 'start_godot' },
      { name: 'assert', tools: assertTools, sample: 'assert_property' },
    ];

    for (const { name, tools, sample } of families) {
      assert.ok(tools.length > 0, `${name} module is empty`);
      assert.ok(tools.some(t => t.name === sample), `${name} module missing expected tool "${sample}"`);
    }
  });

  it('eval and input tools exist in script and runtime modules', () => {
    const scriptNames = scriptTools.map(t => t.name);
    assert.ok(scriptNames.includes('eval_expression'), 'eval_expression missing from scriptTools');
    assert.ok(scriptNames.includes('eval_editor_expression'), 'eval_editor_expression missing from scriptTools');

    const runtimeNames = runtimeTools.map(t => t.name);
    assert.ok(runtimeNames.includes('send_input_action'), 'send_input_action missing from runtimeTools');
    assert.ok(runtimeNames.includes('send_key_event'), 'send_key_event missing from runtimeTools');
  });
});
