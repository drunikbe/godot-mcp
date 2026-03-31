/**
 * Runtime debugging tools for Godot MCP Server
 * Tools for inspecting the running game via EditorDebuggerPlugin bridge
 */

import type { ToolDefinition } from '../bridge/types.js';

export const runtimeTools: ToolDefinition[] = [
  {
    name: 'game_screenshot',
    description: 'Capture a screenshot of the RUNNING game\'s viewport. Returns the image inline as base64 PNG. Use after run_scene to visually verify game state, UI layout, rendering. Runtime debugging auto-enables on first call.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'SubViewport node path to capture instead of main viewport. Optional.'
        }
      }
    }
  },
  {
    name: 'game_scene_tree',
    description: 'Dump the LIVE running game\'s scene tree (NOT the editor scene — use scene_tree_dump for editor). Requires a scene running via run_scene. Runtime debugging auto-enables on first call.',
    inputSchema: {
      type: 'object',
      properties: {
        max_depth: {
          type: 'number',
          description: 'Maximum tree depth. Default: 3'
        },
        max_nodes: {
          type: 'number',
          description: 'Maximum nodes to return. Default: 200.'
        }
      }
    }
  },
  {
    name: 'game_get_properties',
    description: 'Get ALL exported properties and their current RUNTIME values for a specific node in the RUNNING game. Use node paths from game_scene_tree. Sensitive properties are redacted by default.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'Absolute node path (e.g., \'/root/Main/Player\')'
        }
      },
      required: ['node_path']
    }
  },
  {
    name: 'game_get_property',
    description: 'Get a SINGLE property value from a node in the RUNNING game. More efficient than game_get_properties when you know which property you need.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'Absolute node path (e.g., \'/root/Main/Player\')'
        },
        property: {
          type: 'string',
          description: 'Property name (e.g., \'position\', \'health\', \'visible\')'
        }
      },
      required: ['node_path', 'property']
    }
  },
  {
    name: 'send_input_action',
    description: 'Simulate an InputMap action in the RUNNING game. The action must exist in the project\'s Input Map. If duration_ms > 0 and pressed is true, automatically releases after the duration. Requires a scene running via run_scene.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'InputMap action name (e.g., "move_right", "jump", "ui_accept").'
        },
        pressed: {
          type: 'boolean',
          description: 'Whether the action is pressed (true) or released (false). Default: true.'
        },
        strength: {
          type: 'number',
          description: 'Action strength from 0.0 to 1.0 (for analog inputs). Default: 1.0.'
        },
        duration_ms: {
          type: 'number',
          description: 'If > 0 and pressed is true, hold the action for this many milliseconds then release. Default: 0 (instant press or release).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'send_key_event',
    description: 'Simulate a keyboard key press/release in the RUNNING game. Use Godot Key enum names (e.g., "KEY_SPACE", "KEY_W", "KEY_ESCAPE"). Requires a scene running via run_scene.',
    inputSchema: {
      type: 'object',
      properties: {
        keycode: {
          type: 'string',
          description: 'Godot Key enum name (e.g., "KEY_SPACE", "KEY_W", "KEY_UP", "KEY_ESCAPE", "KEY_ENTER").'
        },
        pressed: {
          type: 'boolean',
          description: 'Whether the key is pressed (true) or released (false). Default: true.'
        },
        duration_ms: {
          type: 'number',
          description: 'If > 0 and pressed is true, hold the key for this many milliseconds then release. Default: 0 (instant).'
        }
      },
      required: ['keycode']
    }
  },
];
