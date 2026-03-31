/**
 * Individual tool module definition tests.
 *
 * For each tool module: non-empty, valid schemas, required fields
 * are subsets of properties, and named exports match expectations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileTools } from '../dist/tools/file-tools.js';
import { sceneTools } from '../dist/tools/scene-tools.js';
import { scriptTools } from '../dist/tools/script-tools.js';
import { projectTools } from '../dist/tools/project-tools.js';
import { assetTools } from '../dist/tools/asset-tools.js';
import { runtimeTools } from '../dist/tools/runtime-tools.js';
import { visualizerTools } from '../dist/tools/visualizer-tools.js';
import { lifecycleTools, lifecycleToolNames } from '../dist/tools/lifecycle-tools.js';

/**
 * Shared validation helper for a tool definition array.
 * @param {string} moduleName
 * @param {Array<{name:string,description:string,inputSchema:{type:string,properties:Object,required?:string[]}}>} tools
 */
function validateToolArray(moduleName, tools) {
  it(`${moduleName} exports a non-empty array`, () => {
    assert.ok(Array.isArray(tools), `${moduleName} is not an array`);
    assert.ok(tools.length > 0, `${moduleName} is empty`);
  });

  it(`${moduleName} tools have valid name, description, inputSchema`, () => {
    for (const tool of tools) {
      assert.ok(typeof tool.name === 'string' && tool.name.length > 0, `${moduleName}: tool missing name`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `${moduleName}/${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${moduleName}/${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object', `${moduleName}/${tool.name} schema type != object`);
      assert.ok(
        typeof tool.inputSchema.properties === 'object' && tool.inputSchema.properties !== null,
        `${moduleName}/${tool.name} missing properties`
      );
    }
  });

  it(`${moduleName} required fields are subsets of properties`, () => {
    for (const tool of tools) {
      const propKeys = Object.keys(tool.inputSchema.properties);
      const required = tool.inputSchema.required || [];
      for (const req of required) {
        assert.ok(
          propKeys.includes(req),
          `${moduleName}/${tool.name}: required "${req}" not in properties [${propKeys}]`
        );
      }
    }
  });
}

describe('File tools', () => validateToolArray('fileTools', fileTools));
describe('Scene tools', () => validateToolArray('sceneTools', sceneTools));
describe('Script tools', () => validateToolArray('scriptTools', scriptTools));
describe('Project tools', () => validateToolArray('projectTools', projectTools));
describe('Asset tools', () => validateToolArray('assetTools', assetTools));
describe('Runtime tools', () => validateToolArray('runtimeTools', runtimeTools));
describe('Visualizer tools', () => validateToolArray('visualizerTools', visualizerTools));
describe('Lifecycle tools', () => validateToolArray('lifecycleTools', lifecycleTools));

describe('lifecycleToolNames', () => {
  it('is a Set matching lifecycle tool names', () => {
    assert.ok(lifecycleToolNames instanceof Set);
    assert.equal(lifecycleToolNames.size, lifecycleTools.length);
    for (const tool of lifecycleTools) {
      assert.ok(lifecycleToolNames.has(tool.name), `missing "${tool.name}" in lifecycleToolNames`);
    }
  });

  it('contains start_godot, stop_godot, godot_process_status', () => {
    assert.ok(lifecycleToolNames.has('start_godot'));
    assert.ok(lifecycleToolNames.has('stop_godot'));
    assert.ok(lifecycleToolNames.has('godot_process_status'));
  });
});
