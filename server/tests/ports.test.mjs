/**
 * Port assignment tests.
 *
 * Tests FNV-1a hashing, canonical path resolution, and deterministic
 * port pair computation from project paths.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectPorts, canonicalProjectPath, DEFAULT_WS_PORT, DEFAULT_HTTP_PORT } from '../dist/ports.js';

describe('canonicalProjectPath', () => {
  it('resolves a relative path to absolute', () => {
    const result = canonicalProjectPath('.');
    assert.ok(result.startsWith('/'), 'should be absolute');
    assert.ok(!result.includes('./'), 'should not contain ./');
  });

  it('normalizes redundant separators and dots', () => {
    const result = canonicalProjectPath('/tmp/./foo/../foo/bar');
    assert.equal(result, '/tmp/foo/bar');
  });

  it('handles non-existent paths without throwing', () => {
    const result = canonicalProjectPath('/this/path/does/not/exist/at/all');
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('/this/path/does/not/exist'));
  });

  it('returns the same result for equivalent paths', () => {
    const a = canonicalProjectPath('/tmp/foo/./bar');
    const b = canonicalProjectPath('/tmp/foo/bar');
    assert.equal(a, b);
  });
});

describe('projectPorts', () => {
  it('returns an object with ws and http port numbers', () => {
    const ports = projectPorts('/tmp/my-godot-project');
    assert.ok(typeof ports.ws === 'number');
    assert.ok(typeof ports.http === 'number');
  });

  it('http port is always ws + 1', () => {
    const paths = ['/tmp/project-a', '/tmp/project-b', '/home/user/game', '/var/projects/foo'];
    for (const p of paths) {
      const ports = projectPorts(p);
      assert.equal(ports.http, ports.ws + 1, `http should be ws+1 for ${p}`);
    }
  });

  it('ws port is even-offset within the range 6505-8504', () => {
    const paths = ['/tmp/a', '/tmp/b', '/tmp/c', '/Users/test/games/rpg'];
    for (const p of paths) {
      const ports = projectPorts(p);
      assert.ok(ports.ws >= 6505, `ws ${ports.ws} < 6505 for ${p}`);
      assert.ok(ports.ws <= 8504, `ws ${ports.ws} > 8504 for ${p}`);
      assert.equal((ports.ws - 6505) % 2, 0, `ws port should be at even offset for ${p}`);
    }
  });

  it('returns the same ports for the same project path', () => {
    const a = projectPorts('/tmp/my-godot-project');
    const b = projectPorts('/tmp/my-godot-project');
    assert.deepEqual(a, b);
  });

  it('returns different ports for different project paths', () => {
    const a = projectPorts('/tmp/project-alpha');
    const b = projectPorts('/tmp/project-beta');
    // They might theoretically collide due to hash, but for these paths they should not
    assert.ok(
      a.ws !== b.ws || a.http !== b.http,
      'Different projects should typically get different ports'
    );
  });

  it('equivalent paths produce identical ports', () => {
    const a = projectPorts('/tmp/foo/./bar');
    const b = projectPorts('/tmp/foo/bar');
    assert.deepEqual(a, b);
  });
});

describe('Default port constants', () => {
  it('DEFAULT_WS_PORT is 6505', () => {
    assert.equal(DEFAULT_WS_PORT, 6505);
  });

  it('DEFAULT_HTTP_PORT is 6506', () => {
    assert.equal(DEFAULT_HTTP_PORT, 6506);
  });
});
