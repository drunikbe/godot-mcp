/**
 * Lifecycle tools for managing the Godot editor process.
 *
 * These tools work BEFORE Godot is connected — they are routed in server.ts
 * before the connection gate so the AI can start/stop Godot autonomously.
 */

import type { ToolDefinition } from '../bridge/types.js';

export const lifecycleTools: ToolDefinition[] = [
  {
    name: 'start_godot',
    description: 'Spawn a Godot editor process for a project. Defaults to headless mode. Returns once the plugin connects via WebSocket (up to 60s for first-run asset import). If Godot is already connected, returns current status without spawning.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the Godot project directory (must contain project.godot).'
        },
        headless: {
          type: 'boolean',
          description: 'Run in headless mode (no GUI). Default: true.'
        },
        extra_args: {
          type: 'array',
          description: 'Additional command-line arguments to pass to Godot.',
          items: { type: 'string', description: 'A CLI argument.' }
        }
      },
      required: ['project_path']
    }
  },
  {
    name: 'stop_godot',
    description: 'Gracefully stop the managed Godot process (SIGTERM, then SIGKILL after 5s). No-op if Godot was started externally or is not running.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'godot_process_status',
    description: 'Check the managed Godot process status: running, PID, uptime, WebSocket connection state, and recent stdout/stderr output.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Names of lifecycle tools — used in server.ts to route before connection gate.
 */
export const lifecycleToolNames = new Set(lifecycleTools.map(t => t.name));
