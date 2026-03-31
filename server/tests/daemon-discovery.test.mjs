/**
 * Daemon discovery tests.
 *
 * Tests writeDaemonFile, readDaemonFile, removeDaemonFile, and
 * findProjectRoot using temp directories to avoid filesystem side-effects.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeDaemonFile,
  readDaemonFile,
  removeDaemonFile,
  findProjectRoot,
} from '../dist/daemon-discovery.js';

describe('writeDaemonFile', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'godot-mcp-test-'));
    mkdirSync(join(tmpDir, '.godot'), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a valid JSON file in .godot/mcp-daemon.json', () => {
    writeDaemonFile(tmpDir, {
      pid: process.pid,
      httpPort: 6506,
      wsPort: 6505,
      projectPath: tmpDir,
    });

    const filePath = join(tmpDir, '.godot', 'mcp-daemon.json');
    assert.ok(existsSync(filePath), 'daemon file should exist');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    assert.equal(data.pid, process.pid);
    assert.equal(data.httpPort, 6506);
    assert.equal(data.wsPort, 6505);
    assert.equal(data.projectPath, tmpDir);
    assert.ok(typeof data.startedAt === 'string', 'startedAt should be a string');
    // Validate startedAt is ISO format
    assert.ok(!isNaN(new Date(data.startedAt).getTime()), 'startedAt should be valid ISO date');
  });
});

describe('readDaemonFile', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'godot-mcp-test-'));
    mkdirSync(join(tmpDir, '.godot'), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', () => {
    const result = readDaemonFile(join(tmpDir, 'nonexistent'));
    assert.equal(result, null);
  });

  it('returns null for invalid JSON', () => {
    const filePath = join(tmpDir, '.godot', 'mcp-daemon.json');
    writeFileSync(filePath, 'not json at all');
    const result = readDaemonFile(tmpDir);
    assert.equal(result, null);
  });

  it('returns data when PID is alive (this process)', () => {
    writeDaemonFile(tmpDir, {
      pid: process.pid,
      httpPort: 6506,
      wsPort: 6505,
      projectPath: tmpDir,
    });

    const result = readDaemonFile(tmpDir);
    assert.ok(result !== null, 'should return data for alive PID');
    assert.equal(result.pid, process.pid);
    assert.equal(result.httpPort, 6506);
  });

  it('returns null and removes file for dead PID', () => {
    const filePath = join(tmpDir, '.godot', 'mcp-daemon.json');
    writeFileSync(filePath, JSON.stringify({
      pid: 999999999,  // Very unlikely to be alive
      httpPort: 6506,
      wsPort: 6505,
      projectPath: tmpDir,
      startedAt: new Date().toISOString(),
    }));

    const result = readDaemonFile(tmpDir);
    assert.equal(result, null, 'should return null for dead PID');
    assert.ok(!existsSync(filePath), 'should clean up stale file');
  });
});

describe('removeDaemonFile', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'godot-mcp-test-'));
    mkdirSync(join(tmpDir, '.godot'), { recursive: true });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes the daemon file if it exists', () => {
    const filePath = join(tmpDir, '.godot', 'mcp-daemon.json');
    writeFileSync(filePath, '{}');
    assert.ok(existsSync(filePath));

    removeDaemonFile(tmpDir);
    assert.ok(!existsSync(filePath), 'file should be removed');
  });

  it('does not throw when file is already gone', () => {
    assert.doesNotThrow(() => removeDaemonFile(tmpDir));
  });
});

describe('findProjectRoot', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'godot-mcp-test-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no project.godot found', () => {
    const result = findProjectRoot(tmpDir);
    assert.equal(result, null);
  });

  it('finds project.godot in the start directory', () => {
    writeFileSync(join(tmpDir, 'project.godot'), '');
    const result = findProjectRoot(tmpDir);
    assert.equal(result, tmpDir);
  });

  it('finds project.godot in a parent directory', () => {
    // project.godot is in tmpDir from previous test
    const subDir = join(tmpDir, 'scenes', 'levels');
    mkdirSync(subDir, { recursive: true });
    const result = findProjectRoot(subDir);
    assert.equal(result, tmpDir);
  });

  it('returns null for filesystem root', () => {
    // Clean up project.godot first
    const marker = join(tmpDir, 'project.godot');
    if (existsSync(marker)) rmSync(marker);

    const result = findProjectRoot('/');
    assert.equal(result, null);
  });
});
