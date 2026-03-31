/**
 * Offline tool handlers — Node.js filesystem implementations of tools
 * that work without a Godot connection.
 *
 * These activate only when the WebSocket bridge is disconnected.
 * When Godot is connected, all tools route through the bridge as usual.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';

// ── Path resolution with traversal guard ──────────────────────────

/**
 * Resolve a res:// path to an absolute filesystem path.
 * Throws if the resolved path escapes the project directory.
 */
export function resolveResPath(resPath: string, projectPath: string): string {
  if (!resPath.startsWith('res://')) {
    throw new Error(`Path must start with res:// (got "${resPath}")`);
  }
  const relativePart = resPath.slice('res://'.length);
  const absolutePath = resolve(projectPath, relativePart);

  // Guard: ensure resolved path is within the project directory
  if (!absolutePath.startsWith(resolve(projectPath) + '/') && absolutePath !== resolve(projectPath)) {
    throw new Error(`Path traversal denied: "${resPath}" resolves outside the project directory`);
  }

  return absolutePath;
}

// ── Tool name registry ────────────────────────────────────────────

export const offlineToolNames = new Set([
  // Read-only
  'list_dir',
  'read_file',
  'search_project',
  'list_scripts',
  'read_scene',
  // Write (with rescan journal)
  'create_script',
  'edit_script',
  'create_folder',
  'delete_file',
  'rename_file',
]);

// ── Pending rescan tracking ───────────────────────────────────────

let pendingRescan = false;

export function hasPendingRescan(): boolean {
  return pendingRescan;
}

export function clearPendingRescan(): void {
  pendingRescan = false;
}

function markPendingRescan(): void {
  pendingRescan = true;
}

// ── Dispatcher ────────────────────────────────────────────────────

export async function handleOfflineTool(
  name: string,
  args: Record<string, unknown>,
  projectPath: string
): Promise<unknown> {
  switch (name) {
    case 'list_dir':       return listDir(args, projectPath);
    case 'read_file':      return readFile(args, projectPath);
    case 'search_project': return searchProject(args, projectPath);
    case 'list_scripts':   return listScripts(projectPath);
    case 'read_scene':     return readScene(args, projectPath);
    case 'create_script':  return createScript(args, projectPath);
    case 'edit_script':    return editScript(args, projectPath);
    case 'create_folder':  return createFolder(args, projectPath);
    case 'delete_file':    return deleteFile(args, projectPath);
    case 'rename_file':    return renameFile(args, projectPath);
    default:
      throw new Error(`Unknown offline tool: ${name}`);
  }
}

// ── Read-only tool implementations ────────────────────────────────

function listDir(args: Record<string, unknown>, projectPath: string): unknown {
  const root = (args.root as string) || 'res://';
  const absPath = resolveResPath(root, projectPath);

  if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
    return { ok: false, error: `Directory not found: ${root}` };
  }

  const entries = readdirSync(absPath, { withFileTypes: true });
  const files: string[] = [];
  const folders: string[] = [];

  for (const entry of entries) {
    // Skip hidden/Godot internal directories
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      folders.push(entry.name);
    } else {
      files.push(entry.name);
    }
  }

  return { ok: true, path: root, files, folders };
}

function readFile(args: Record<string, unknown>, projectPath: string): unknown {
  const filePath = args.path as string;
  if (!filePath) return { ok: false, error: 'path is required' };

  const absPath = resolveResPath(filePath, projectPath);

  if (!existsSync(absPath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(absPath, 'utf-8');
  const lines = content.split('\n');

  const startLine = (args.start_line as number) || 1;
  const endLine = (args.end_line as number) || lines.length;

  const selectedLines = lines.slice(startLine - 1, endLine);

  return {
    ok: true,
    path: filePath,
    content: selectedLines.join('\n'),
    total_lines: lines.length,
    start_line: startLine,
    end_line: Math.min(endLine, lines.length),
  };
}

function searchProject(args: Record<string, unknown>, projectPath: string): unknown {
  const query = args.query as string;
  if (!query) return { ok: false, error: 'query is required' };

  const glob = (args.glob as string) || '**/*';
  const queryLower = query.toLowerCase();
  const results: Array<{ file: string; line: number; text: string }> = [];
  const MAX_RESULTS = 100;

  function searchDir(dir: string, resPrefix: string): void {
    if (results.length >= MAX_RESULTS) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name.startsWith('.') || entry.name === 'addons') continue;

      const fullPath = join(dir, entry.name);
      const resPath = `${resPrefix}${entry.name}`;

      if (entry.isDirectory()) {
        searchDir(fullPath, `${resPath}/`);
      } else {
        // Apply glob filter (simple extension check)
        if (glob !== '**/*') {
          const ext = glob.replace('**/*', '');
          if (!entry.name.endsWith(ext)) continue;
        }

        // Skip binary files
        const binaryExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ogg', '.wav', '.mp3', '.tres', '.res', '.import'];
        if (binaryExts.includes(extname(entry.name).toLowerCase())) continue;

        try {
          const content = readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({ file: resPath, line: i + 1, text: lines[i].trim() });
              if (results.length >= MAX_RESULTS) return;
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  searchDir(projectPath, 'res://');
  return { ok: true, query, results, count: results.length, truncated: results.length >= MAX_RESULTS };
}

function listScripts(projectPath: string): unknown {
  const scripts: Array<{ path: string; size: number }> = [];

  function scanDir(dir: string, resPrefix: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      const resPath = `${resPrefix}${entry.name}`;

      if (entry.isDirectory()) {
        scanDir(fullPath, `${resPath}/`);
      } else if (entry.name.endsWith('.gd')) {
        try {
          const stats = statSync(fullPath);
          scripts.push({ path: resPath, size: stats.size });
        } catch {
          scripts.push({ path: resPath, size: 0 });
        }
      }
    }
  }

  scanDir(projectPath, 'res://');
  return { ok: true, scripts, count: scripts.length };
}

function readScene(args: Record<string, unknown>, projectPath: string): unknown {
  const scenePath = args.scene_path as string;
  if (!scenePath) return { ok: false, error: 'scene_path is required' };

  const absPath = resolveResPath(scenePath, projectPath);

  if (!existsSync(absPath)) {
    return { ok: false, error: `Scene file not found: ${scenePath}` };
  }

  const content = readFileSync(absPath, 'utf-8');

  return {
    ok: true,
    path: scenePath,
    content,
    unparsed: true,
    note: 'Raw .tscn text returned (offline mode — Godot not connected). Structured parsing requires Godot.',
  };
}

// ── Write tool implementations ────────────────────────────────────

function createScript(args: Record<string, unknown>, projectPath: string): unknown {
  const filePath = args.path as string;
  const content = args.content as string;
  if (!filePath) return { ok: false, error: 'path is required' };
  if (content === undefined) return { ok: false, error: 'content is required' };

  const absPath = resolveResPath(filePath, projectPath);

  if (existsSync(absPath)) {
    return { ok: false, error: `File already exists: ${filePath}. Use edit_script to modify existing files.` };
  }

  // Ensure parent directory exists
  const parentDir = join(absPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(absPath, content, 'utf-8');
  markPendingRescan();

  return {
    ok: true,
    path: filePath,
    message: `Script created (offline mode). Editor filesystem will rescan when Godot connects.`,
  };
}

function editScript(args: Record<string, unknown>, projectPath: string): unknown {
  const edit = args.edit as Record<string, unknown>;
  if (!edit) return { ok: false, error: 'edit is required' };

  const type = edit.type as string;
  if (type !== 'snippet_replace') {
    return { ok: false, error: `Unsupported edit type: ${type}. Only snippet_replace is supported offline.` };
  }

  const filePath = edit.file as string;
  const oldSnippet = edit.old_snippet as string;
  const newSnippet = edit.new_snippet as string;

  if (!filePath || oldSnippet === undefined || newSnippet === undefined) {
    return { ok: false, error: 'edit requires file, old_snippet, and new_snippet' };
  }

  const absPath = resolveResPath(filePath, projectPath);

  if (!existsSync(absPath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const content = readFileSync(absPath, 'utf-8');

  if (!content.includes(oldSnippet)) {
    return { ok: false, error: 'old_snippet not found in file' };
  }

  const newContent = content.replace(oldSnippet, newSnippet);
  writeFileSync(absPath, newContent, 'utf-8');
  markPendingRescan();

  return {
    ok: true,
    path: filePath,
    message: 'Edit applied (offline mode). Editor filesystem will rescan when Godot connects.',
  };
}

function createFolder(args: Record<string, unknown>, projectPath: string): unknown {
  const folderPath = args.path as string;
  if (!folderPath) return { ok: false, error: 'path is required' };

  const absPath = resolveResPath(folderPath, projectPath);
  mkdirSync(absPath, { recursive: true });
  markPendingRescan();

  return { ok: true, path: folderPath };
}

function deleteFile(args: Record<string, unknown>, projectPath: string): unknown {
  const filePath = args.path as string;
  const confirm = args.confirm as boolean;
  if (!filePath) return { ok: false, error: 'path is required' };
  if (!confirm) return { ok: false, error: 'confirm must be true to delete' };

  const absPath = resolveResPath(filePath, projectPath);

  if (!existsSync(absPath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  const createBackup = (args.create_backup as boolean) ?? true;
  if (createBackup) {
    const backupPath = absPath + '.bak';
    copyFileSync(absPath, backupPath);
  }

  unlinkSync(absPath);
  markPendingRescan();

  return {
    ok: true,
    path: filePath,
    message: `File deleted (offline mode). Editor filesystem will rescan when Godot connects.`,
  };
}

function renameFile(args: Record<string, unknown>, projectPath: string): unknown {
  const oldPath = args.old_path as string;
  const newPath = args.new_path as string;
  if (!oldPath || !newPath) return { ok: false, error: 'old_path and new_path are required' };

  const absOldPath = resolveResPath(oldPath, projectPath);
  const absNewPath = resolveResPath(newPath, projectPath);

  if (!existsSync(absOldPath)) {
    return { ok: false, error: `File not found: ${oldPath}` };
  }

  // Ensure parent directory of new path exists
  const parentDir = join(absNewPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  renameSync(absOldPath, absNewPath);
  markPendingRescan();

  return {
    ok: true,
    old_path: oldPath,
    new_path: newPath,
    message: 'File renamed (offline mode). Editor filesystem will rescan when Godot connects.',
    note: 'References in other files were NOT updated (requires Godot editor).',
  };
}
