/**
 * Resource definition and readResource tests.
 *
 * Validates static/template resource arrays, schema completeness,
 * and error paths in readResource (disconnected bridge, unknown URI).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { staticResources, resourceTemplates, readResource } from '../dist/resources/index.js';

describe('Static resources', () => {
  it('has 7 entries', () => {
    assert.equal(staticResources.length, 7);
  });

  it('contains expected URIs', () => {
    const uris = staticResources.map(r => r.uri);
    const expected = [
      'godot://project/settings',
      'godot://project/input-map',
      'godot://scenes',
      'godot://scripts',
      'godot://editor/scene-tree',
      'godot://editor/errors',
      'godot://editor/console',
    ];
    assert.deepEqual(uris, expected);
  });

  it('every resource has uri, name, description, mimeType', () => {
    for (const r of staticResources) {
      assert.ok(typeof r.uri === 'string' && r.uri.length > 0, `missing uri`);
      assert.ok(typeof r.name === 'string' && r.name.length > 0, `${r.uri} missing name`);
      assert.ok(typeof r.description === 'string' && r.description.length > 0, `${r.uri} missing description`);
      assert.ok(typeof r.mimeType === 'string' && r.mimeType.length > 0, `${r.uri} missing mimeType`);
    }
  });
});

describe('Resource templates', () => {
  it('has 2 entries', () => {
    assert.equal(resourceTemplates.length, 2);
  });

  it('contains expected uriTemplates', () => {
    const templates = resourceTemplates.map(r => r.uriTemplate);
    assert.deepEqual(templates, ['godot://scene/{path}', 'godot://file/{path}']);
  });

  it('every template has uriTemplate, name, description, mimeType', () => {
    for (const r of resourceTemplates) {
      assert.ok(typeof r.uriTemplate === 'string' && r.uriTemplate.length > 0, `missing uriTemplate`);
      assert.ok(typeof r.name === 'string' && r.name.length > 0, `${r.uriTemplate} missing name`);
      assert.ok(typeof r.description === 'string' && r.description.length > 0, `${r.uriTemplate} missing description`);
      assert.ok(typeof r.mimeType === 'string' && r.mimeType.length > 0, `${r.uriTemplate} missing mimeType`);
    }
  });
});

describe('readResource', () => {
  /** @type {any} */
  const disconnectedBridge = { isConnected: () => false };

  it('throws when bridge is not connected', async () => {
    await assert.rejects(
      () => readResource('godot://project/settings', disconnectedBridge),
      { message: /not connected/ }
    );
  });

  it('throws for unknown URI with connected bridge', async () => {
    /** @type {any} */
    const connectedBridge = { isConnected: () => true };
    await assert.rejects(
      () => readResource('godot://nonexistent/resource', connectedBridge),
      { message: /Unknown resource URI/ }
    );
  });
});
