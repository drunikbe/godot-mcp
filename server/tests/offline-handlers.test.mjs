/**
 * Offline handler tests — validates filesystem fallback tools
 * including path traversal protection, read/write operations,
 * and the pending rescan mechanism.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolveResPath,
  offlineToolNames,
  handleOfflineTool,
  hasPendingRescan,
  clearPendingRescan,
} from '../dist/tools/offline-handlers.js';

// ── Test project setup ────────────────────────────────────────────

let projectPath;

beforeEach(() => {
  projectPath = join(tmpdir(), `godot-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(projectPath, 'scripts'), { recursive: true });
  mkdirSync(join(projectPath, 'scenes'), { recursive: true });

  writeFileSync(join(projectPath, 'project.godot'), '[application]\nconfig/name="TestProject"\n');
  writeFileSync(join(projectPath, 'scripts', 'player.gd'), 'extends CharacterBody2D\n\nvar speed = 200\n\nfunc _ready():\n\tpass');
  writeFileSync(join(projectPath, 'scripts', 'enemy.gd'), 'extends Node2D\n\nvar health = 100\n');
  writeFileSync(join(projectPath, 'scenes', 'main.tscn'), '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n');

  clearPendingRescan();
});

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
});

// ── resolveResPath ────────────────────────────────────────────────

describe('resolveResPath', () => {
  it('resolves valid res:// paths', () => {
    const result = resolveResPath('res://scripts/player.gd', projectPath);
    assert.equal(result, join(projectPath, 'scripts', 'player.gd'));
  });

  it('resolves res:// root', () => {
    const result = resolveResPath('res://', projectPath);
    assert.equal(result, projectPath);
  });

  it('rejects paths not starting with res://', () => {
    assert.throws(() => resolveResPath('/etc/passwd', projectPath), /must start with res:\/\//);
    assert.throws(() => resolveResPath('scripts/player.gd', projectPath), /must start with res:\/\//);
  });

  it('rejects path traversal attacks', () => {
    assert.throws(() => resolveResPath('res://../../../etc/passwd', projectPath), /traversal denied/);
    assert.throws(() => resolveResPath('res://scripts/../../etc/passwd', projectPath), /traversal denied/);
  });

  it('allows deeply nested valid paths', () => {
    const result = resolveResPath('res://a/b/c/d.gd', projectPath);
    assert.ok(result.startsWith(projectPath));
  });
});

// ── offlineToolNames ──────────────────────────────────────────────

describe('offlineToolNames', () => {
  it('contains expected tools', () => {
    const expected = [
      'list_dir', 'read_file', 'search_project', 'list_scripts', 'read_scene',
      'create_script', 'edit_script', 'create_folder', 'delete_file', 'rename_file',
    ];
    for (const name of expected) {
      assert.ok(offlineToolNames.has(name), `missing ${name}`);
    }
    assert.equal(offlineToolNames.size, expected.length);
  });
});

// ── Read-only tools ───────────────────────────────────────────────

describe('list_dir', () => {
  it('lists files and folders', async () => {
    const result = await handleOfflineTool('list_dir', { root: 'res://' }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(result.files.includes('project.godot'));
    assert.ok(result.folders.includes('scripts'));
    assert.ok(result.folders.includes('scenes'));
  });

  it('skips hidden files', async () => {
    writeFileSync(join(projectPath, '.hidden'), 'secret');
    const result = await handleOfflineTool('list_dir', { root: 'res://' }, projectPath);
    assert.ok(!result.files.includes('.hidden'));
  });

  it('returns error for non-existent directory', async () => {
    const result = await handleOfflineTool('list_dir', { root: 'res://nonexistent' }, projectPath);
    assert.equal(result.ok, false);
  });

  it('does not set pending rescan', async () => {
    await handleOfflineTool('list_dir', { root: 'res://' }, projectPath);
    assert.equal(hasPendingRescan(), false);
  });
});

describe('read_file', () => {
  it('reads file content', async () => {
    const result = await handleOfflineTool('read_file', { path: 'res://scripts/player.gd' }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(result.content.includes('CharacterBody2D'));
    assert.equal(result.total_lines, 6);
  });

  it('supports line ranges', async () => {
    const result = await handleOfflineTool('read_file', { path: 'res://scripts/player.gd', start_line: 1, end_line: 1 }, projectPath);
    assert.equal(result.ok, true);
    assert.equal(result.content, 'extends CharacterBody2D');
  });

  it('returns error for missing file', async () => {
    const result = await handleOfflineTool('read_file', { path: 'res://nope.gd' }, projectPath);
    assert.equal(result.ok, false);
  });
});

describe('search_project', () => {
  it('finds matches across files', async () => {
    const result = await handleOfflineTool('search_project', { query: 'extends' }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(result.count >= 2);
  });

  it('respects glob filter', async () => {
    const result = await handleOfflineTool('search_project', { query: 'extends', glob: '**/*.gd' }, projectPath);
    assert.equal(result.ok, true);
    // Should only find .gd files
    for (const r of result.results) {
      assert.ok(r.file.endsWith('.gd'), `unexpected file: ${r.file}`);
    }
  });

  it('is case-insensitive', async () => {
    const result = await handleOfflineTool('search_project', { query: 'CHARACTERBODY2D' }, projectPath);
    assert.ok(result.count >= 1);
  });
});

describe('list_scripts', () => {
  it('lists all .gd files', async () => {
    const result = await handleOfflineTool('list_scripts', {}, projectPath);
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    const paths = result.scripts.map(s => s.path);
    assert.ok(paths.includes('res://scripts/player.gd'));
    assert.ok(paths.includes('res://scripts/enemy.gd'));
  });
});

describe('read_scene', () => {
  it('returns raw tscn content', async () => {
    const result = await handleOfflineTool('read_scene', { scene_path: 'res://scenes/main.tscn' }, projectPath);
    assert.equal(result.ok, true);
    assert.equal(result.unparsed, true);
    assert.ok(result.content.includes('gd_scene'));
  });

  it('returns error for missing scene', async () => {
    const result = await handleOfflineTool('read_scene', { scene_path: 'res://nope.tscn' }, projectPath);
    assert.equal(result.ok, false);
  });
});

// ── Write tools ───────────────────────────────────────────────────

describe('create_script', () => {
  it('creates a new script', async () => {
    const result = await handleOfflineTool('create_script', {
      path: 'res://scripts/new_script.gd',
      content: 'extends Node\n',
    }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(projectPath, 'scripts', 'new_script.gd')));
    assert.equal(hasPendingRescan(), true);
  });

  it('rejects if file already exists', async () => {
    const result = await handleOfflineTool('create_script', {
      path: 'res://scripts/player.gd',
      content: 'overwrite',
    }, projectPath);
    assert.equal(result.ok, false);
  });

  it('creates parent directories', async () => {
    const result = await handleOfflineTool('create_script', {
      path: 'res://deep/nested/dir/script.gd',
      content: 'extends Node\n',
    }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(projectPath, 'deep', 'nested', 'dir', 'script.gd')));
  });
});

describe('edit_script', () => {
  it('replaces a snippet', async () => {
    clearPendingRescan();
    const result = await handleOfflineTool('edit_script', {
      edit: {
        type: 'snippet_replace',
        file: 'res://scripts/player.gd',
        old_snippet: 'var speed = 200',
        new_snippet: 'var speed = 300',
      },
    }, projectPath);
    assert.equal(result.ok, true);
    const content = readFileSync(join(projectPath, 'scripts', 'player.gd'), 'utf-8');
    assert.ok(content.includes('var speed = 300'));
    assert.equal(hasPendingRescan(), true);
  });

  it('returns error when snippet not found', async () => {
    const result = await handleOfflineTool('edit_script', {
      edit: {
        type: 'snippet_replace',
        file: 'res://scripts/player.gd',
        old_snippet: 'nonexistent code',
        new_snippet: 'replacement',
      },
    }, projectPath);
    assert.equal(result.ok, false);
  });
});

describe('create_folder', () => {
  it('creates directory recursively', async () => {
    clearPendingRescan();
    const result = await handleOfflineTool('create_folder', { path: 'res://new/deep/folder' }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(projectPath, 'new', 'deep', 'folder')));
    assert.equal(hasPendingRescan(), true);
  });
});

describe('delete_file', () => {
  it('deletes a file with backup', async () => {
    clearPendingRescan();
    const result = await handleOfflineTool('delete_file', {
      path: 'res://scripts/enemy.gd',
      confirm: true,
      create_backup: true,
    }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(!existsSync(join(projectPath, 'scripts', 'enemy.gd')));
    assert.ok(existsSync(join(projectPath, 'scripts', 'enemy.gd.bak')));
    assert.equal(hasPendingRescan(), true);
  });

  it('rejects without confirm', async () => {
    const result = await handleOfflineTool('delete_file', {
      path: 'res://scripts/enemy.gd',
      confirm: false,
    }, projectPath);
    assert.equal(result.ok, false);
    assert.ok(existsSync(join(projectPath, 'scripts', 'enemy.gd')));
  });
});

describe('rename_file', () => {
  it('renames a file', async () => {
    clearPendingRescan();
    const result = await handleOfflineTool('rename_file', {
      old_path: 'res://scripts/enemy.gd',
      new_path: 'res://scripts/boss.gd',
    }, projectPath);
    assert.equal(result.ok, true);
    assert.ok(!existsSync(join(projectPath, 'scripts', 'enemy.gd')));
    assert.ok(existsSync(join(projectPath, 'scripts', 'boss.gd')));
    assert.equal(hasPendingRescan(), true);
  });
});

// ── Pending rescan ────────────────────────────────────────────────

describe('pending rescan', () => {
  it('starts cleared', () => {
    assert.equal(hasPendingRescan(), false);
  });

  it('is set after any write operation', async () => {
    await handleOfflineTool('create_folder', { path: 'res://tmp' }, projectPath);
    assert.equal(hasPendingRescan(), true);
  });

  it('can be cleared', async () => {
    await handleOfflineTool('create_folder', { path: 'res://tmp2' }, projectPath);
    assert.equal(hasPendingRescan(), true);
    clearPendingRescan();
    assert.equal(hasPendingRescan(), false);
  });
});
