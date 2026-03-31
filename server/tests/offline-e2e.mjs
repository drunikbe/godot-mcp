#!/usr/bin/env node
/**
 * End-to-end test for offline MCP tools.
 * Requires a running daemon on port 7550 with NO Godot connection.
 *
 * Usage: node tests/offline-e2e.mjs
 */

const MCP_URL = 'http://127.0.0.1:7550/mcp';
let sessionId = null;
let requestId = 0;
let passed = 0;
let failed = 0;

async function mcpRequest(body) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  const newSessionId = res.headers.get('mcp-session-id');
  if (newSessionId) sessionId = newSessionId;

  // Notifications return 202 with no body
  if (res.status === 202 || res.status === 204) return null;

  const text = await res.text();
  if (!text || text.trim() === '') return null;

  // Handle SSE responses
  if (text.startsWith('event:') || text.startsWith('data:')) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          return JSON.parse(line.slice(6));
        } catch { /* skip non-JSON data lines */ }
      }
    }
    throw new Error(`No JSON data in SSE response: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

async function initialize() {
  const result = await mcpRequest({
    jsonrpc: '2.0',
    id: ++requestId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'offline-e2e-test', version: '1.0.0' },
    }
  });
  console.log(`Session initialized: ${sessionId}`);

  // Send initialized notification
  await mcpRequest({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });

  return result;
}

async function callTool(name, args = {}) {
  return mcpRequest({
    jsonrpc: '2.0',
    id: ++requestId,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

async function readResource(uri) {
  return mcpRequest({
    jsonrpc: '2.0',
    id: ++requestId,
    method: 'resources/read',
    params: { uri },
  });
}

function parseToolResult(response) {
  if (response.error) return { _error: response.error };
  const content = response.result?.content;
  if (!content || !content[0]) return null;
  try {
    return JSON.parse(content[0].text);
  } catch {
    return content[0].text;
  }
}

function assert(condition, testName, detail) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────

async function testGetGodotStatus() {
  console.log('\n🔧 get_godot_status (built-in, always works)');
  const res = await callTool('get_godot_status');
  const data = parseToolResult(res);
  assert(data.connected === false, 'Godot is not connected');
  assert(data.mode === 'waiting', 'Mode is waiting');
  assert(typeof data.server_version === 'string', 'Has server version');
}

async function testListDir() {
  console.log('\n📁 list_dir');
  const res = await callTool('list_dir', { root: 'res://' });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Returns ok: true');
  assert(Array.isArray(data.files), 'Has files array');
  assert(Array.isArray(data.folders), 'Has folders array');
  assert(data.files.includes('project.godot'), 'Lists project.godot');
  assert(data.folders.includes('addons'), 'Lists addons folder');
  assert(data.folders.includes('server'), 'Lists server folder');

  // Subdirectory
  const res2 = await callTool('list_dir', { root: 'res://addons' });
  const data2 = parseToolResult(res2);
  assert(data2.ok === true, 'Subdirectory listing works');
  assert(data2.folders.includes('godot_mcp'), 'Lists godot_mcp addon');

  // Non-existent directory
  const res3 = await callTool('list_dir', { root: 'res://nonexistent_dir' });
  const data3 = parseToolResult(res3);
  assert(data3.ok === false, 'Returns ok: false for missing dir');
}

async function testReadFile() {
  console.log('\n📄 read_file');
  const res = await callTool('read_file', { path: 'res://project.godot' });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Returns ok: true');
  assert(data.content.includes('config/name'), 'Content has config/name');
  assert(typeof data.total_lines === 'number', 'Has total_lines');

  // Line range
  const res2 = await callTool('read_file', { path: 'res://project.godot', start_line: 1, end_line: 2 });
  const data2 = parseToolResult(res2);
  assert(data2.ok === true, 'Line range works');
  assert(data2.start_line === 1, 'Start line correct');
  assert(data2.end_line === 2, 'End line correct');

  // Non-existent file
  const res3 = await callTool('read_file', { path: 'res://nope.gd' });
  const data3 = parseToolResult(res3);
  assert(data3.ok === false, 'Returns ok: false for missing file');

  // Path traversal attack
  const res4 = await callTool('read_file', { path: 'res://../../../etc/passwd' });
  const data4 = parseToolResult(res4);
  assert(data4.error && data4.error.includes('traversal'), 'Blocks path traversal');
}

async function testSearchProject() {
  console.log('\n🔍 search_project');
  const res = await callTool('search_project', { query: 'extends' });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Returns ok: true');
  assert(data.count > 0, `Found ${data.count} results`);
  assert(Array.isArray(data.results), 'Has results array');
  assert(data.results[0].file && data.results[0].line, 'Results have file and line');

  // With glob filter
  const res2 = await callTool('search_project', { query: 'extends', glob: '**/*.gd' });
  const data2 = parseToolResult(res2);
  assert(data2.ok === true, 'Glob filter works');
  const allGd = data2.results.every(r => r.file.endsWith('.gd'));
  assert(allGd, 'All results are .gd files');
}

async function testListScripts() {
  console.log('\n📜 list_scripts');
  const res = await callTool('list_scripts', {});
  const data = parseToolResult(res);
  assert(data.ok === true, 'Returns ok: true');
  assert(data.count > 0, `Found ${data.count} scripts`);
  const paths = data.scripts.map(s => s.path);
  assert(paths.some(p => p.includes('plugin.gd')), 'Finds plugin.gd');
  assert(paths.some(p => p.includes('mcp_client.gd')), 'Finds mcp_client.gd');
}

async function testReadScene() {
  console.log('\n🎬 read_scene');
  // Find a .tscn file first
  const listRes = await callTool('list_dir', { root: 'res://' });
  const listData = parseToolResult(listRes);
  const tscnFiles = listData.files?.filter(f => f.endsWith('.tscn')) || [];

  if (tscnFiles.length > 0) {
    const scenePath = `res://${tscnFiles[0]}`;
    const res = await callTool('read_scene', { scene_path: scenePath });
    const data = parseToolResult(res);
    assert(data.ok === true, `Reads ${scenePath}`);
    assert(data.unparsed === true, 'Marked as unparsed');
    assert(typeof data.content === 'string', 'Has string content');
    assert(data.content.includes('gd_scene') || data.content.includes('gd_resource'), 'Content looks like TSCN');
  } else {
    console.log('  ⏭️  No .tscn files in root — skipping');
  }

  // Non-existent scene
  const res2 = await callTool('read_scene', { scene_path: 'res://nonexistent.tscn' });
  const data2 = parseToolResult(res2);
  assert(data2.ok === false, 'Returns ok: false for missing scene');
}

async function testCreateScript() {
  console.log('\n✏️  create_script');
  const testPath = 'res://_test_offline_e2e_create.gd';
  const res = await callTool('create_script', {
    path: testPath,
    content: 'extends Node\n\nfunc _ready():\n\tprint("offline test")\n',
  });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Creates script');
  assert(data.message?.includes('offline'), 'Message mentions offline mode');

  // Verify it exists by reading it back
  const readRes = await callTool('read_file', { path: testPath });
  const readData = parseToolResult(readRes);
  assert(readData.ok === true, 'Created file is readable');
  assert(readData.content.includes('offline test'), 'Content matches');

  // Reject duplicate creation
  const res2 = await callTool('create_script', { path: testPath, content: 'duplicate' });
  const data2 = parseToolResult(res2);
  assert(data2.ok === false, 'Rejects duplicate creation');
}

async function testEditScript() {
  console.log('\n✂️  edit_script');
  const testPath = 'res://_test_offline_e2e_create.gd';
  const res = await callTool('edit_script', {
    edit: {
      type: 'snippet_replace',
      file: testPath,
      old_snippet: 'print("offline test")',
      new_snippet: 'print("edited offline")',
    },
  });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Edit succeeds');

  // Verify edit
  const readRes = await callTool('read_file', { path: testPath });
  const readData = parseToolResult(readRes);
  assert(readData.content.includes('edited offline'), 'Edit is applied');
  assert(!readData.content.includes('offline test'), 'Old snippet is gone');

  // Snippet not found
  const res2 = await callTool('edit_script', {
    edit: {
      type: 'snippet_replace',
      file: testPath,
      old_snippet: 'nonexistent code block',
      new_snippet: 'replacement',
    },
  });
  const data2 = parseToolResult(res2);
  assert(data2.ok === false, 'Rejects when snippet not found');
}

async function testCreateFolder() {
  console.log('\n📂 create_folder');
  const res = await callTool('create_folder', { path: 'res://_test_offline_e2e_folder/nested' });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Creates nested folder');

  // Verify via list_dir
  const listRes = await callTool('list_dir', { root: 'res://_test_offline_e2e_folder' });
  const listData = parseToolResult(listRes);
  assert(listData.ok === true, 'New folder is listable');
  assert(listData.folders.includes('nested'), 'Nested folder exists');
}

async function testRenameFile() {
  console.log('\n🔄 rename_file');
  const res = await callTool('rename_file', {
    old_path: 'res://_test_offline_e2e_create.gd',
    new_path: 'res://_test_offline_e2e_renamed.gd',
  });
  const data = parseToolResult(res);
  assert(data.ok === true, 'Rename succeeds');
  assert(data.note?.includes('NOT updated'), 'Warns about references');

  // Old path gone
  const readOld = await callTool('read_file', { path: 'res://_test_offline_e2e_create.gd' });
  assert(parseToolResult(readOld).ok === false, 'Old path no longer exists');

  // New path works
  const readNew = await callTool('read_file', { path: 'res://_test_offline_e2e_renamed.gd' });
  assert(parseToolResult(readNew).ok === true, 'New path is readable');
}

async function testDeleteFile() {
  console.log('\n🗑️  delete_file');
  // Reject without confirm
  const res1 = await callTool('delete_file', { path: 'res://_test_offline_e2e_renamed.gd', confirm: false });
  const data1 = parseToolResult(res1);
  assert(data1.ok === false, 'Rejects without confirm=true');

  // Delete with confirm + backup
  const res2 = await callTool('delete_file', { path: 'res://_test_offline_e2e_renamed.gd', confirm: true, create_backup: true });
  const data2 = parseToolResult(res2);
  assert(data2.ok === true, 'Deletes with confirm');

  // Verify deleted
  const readRes = await callTool('read_file', { path: 'res://_test_offline_e2e_renamed.gd' });
  assert(parseToolResult(readRes).ok === false, 'File is gone');

  // Backup exists
  const backupRes = await callTool('read_file', { path: 'res://_test_offline_e2e_renamed.gd.bak' });
  assert(parseToolResult(backupRes).ok === true, 'Backup file exists');
}

async function testGodotRequiredTools() {
  console.log('\n🚫 Godot-required tools (should give helpful errors)');
  const toolsToTest = ['validate_script', 'scene_tree_dump', 'run_scene', 'get_project_settings'];
  for (const tool of toolsToTest) {
    const res = await callTool(tool, { path: 'res://test.gd' });
    const data = parseToolResult(res);
    assert(data.error !== undefined, `${tool} returns error when Godot disconnected`);
    assert(
      data.hint?.includes('start_godot') || data.hint?.includes('requires'),
      `${tool} error hint mentions start_godot`
    );
  }
}

async function testResources() {
  console.log('\n📚 Resource fallbacks');

  // godot://scripts — should work offline
  const scriptsRes = await readResource('godot://scripts');
  const scriptsContent = scriptsRes.result?.contents?.[0];
  assert(scriptsContent !== undefined, 'godot://scripts returns content');
  if (scriptsContent) {
    const data = JSON.parse(scriptsContent.text);
    assert(data.ok === true, 'godot://scripts offline returns ok');
    assert(data.count > 0, `godot://scripts found ${data.count} scripts`);
  }

  // godot://scenes — should work offline
  const scenesRes = await readResource('godot://scenes');
  const scenesContent = scenesRes.result?.contents?.[0];
  assert(scenesContent !== undefined, 'godot://scenes returns content');

  // godot://file/{path} — should work offline
  const fileRes = await readResource('godot://file/res://project.godot');
  const fileContent = fileRes.result?.contents?.[0];
  assert(fileContent !== undefined, 'godot://file/{path} returns content');
  if (fileContent) {
    const data = JSON.parse(fileContent.text);
    assert(data.ok === true, 'godot://file offline returns ok');
    assert(data.content?.includes('config/name'), 'godot://file content correct');
  }

  // godot://editor/scene-tree — should fail gracefully (needs Godot)
  const treeRes = await readResource('godot://editor/scene-tree');
  assert(treeRes.error !== undefined, 'godot://editor/scene-tree returns error offline');
}

// ── Cleanup & run ─────────────────────────────────────────────────

async function cleanup() {
  console.log('\n🧹 Cleanup');
  // Clean up test files
  await callTool('delete_file', { path: 'res://_test_offline_e2e_renamed.gd.bak', confirm: true, create_backup: false });
  await callTool('delete_file', { path: 'res://_test_offline_e2e_create.gd', confirm: true, create_backup: false });

  // Clean up test folder (can't delete via tool, use node:fs)
  const { rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  try {
    rmSync(join(process.cwd(), '_test_offline_e2e_folder'), { recursive: true, force: true });
  } catch { /* ignore */ }
  console.log('  ✅ Cleaned up test files');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Offline MCP Tools — End-to-End Test');
  console.log('  Daemon: http://127.0.0.1:7550 (no Godot)');
  console.log('═══════════════════════════════════════════════');

  try {
    await initialize();

    // Read-only tools
    await testGetGodotStatus();
    await testListDir();
    await testReadFile();
    await testSearchProject();
    await testListScripts();
    await testReadScene();

    // Write tools
    await testCreateScript();
    await testEditScript();
    await testCreateFolder();
    await testRenameFile();
    await testDeleteFile();

    // Godot-required tools
    await testGodotRequiredTools();

    // Resources
    await testResources();

    // Cleanup
    await cleanup();

    console.log('\n═══════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════');

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(2);
  }
}

main();
