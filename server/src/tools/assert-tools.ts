/**
 * Assertion meta-tools for structured verification.
 *
 * These tools run on the TypeScript side and internally call existing Godot
 * tools (game_get_property, game_scene_tree) via the bridge. No new GDScript
 * code is needed.
 */

import type { ToolDefinition } from '../bridge/types.js';
import type { GodotBridge } from '../bridge/godot-bridge.js';

export const assertTools: ToolDefinition[] = [
  {
    name: 'assert_property',
    description: 'Assert that a runtime property on a node in the RUNNING game meets a condition. Returns {pass: bool, actual, expected, message}. For float comparisons with "eq", uses tolerance (default 0.0001) to avoid precision issues.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'Absolute node path (e.g., "/root/Main/Player").'
        },
        property: {
          type: 'string',
          description: 'Property name (e.g., "position:x", "health", "visible").'
        },
        expected: {
          type: 'string',
          description: 'Expected value (as string — will be parsed to match the actual type). For numbers use "100", for bools "true"/"false", for strings the literal value.'
        },
        comparator: {
          type: 'string',
          description: 'Comparison operator. Default: "eq".',
          enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'matches_regex']
        },
        tolerance: {
          type: 'number',
          description: 'Tolerance for numeric "eq" comparisons. Default: 0.0001.'
        }
      },
      required: ['node_path', 'property', 'expected']
    }
  },
  {
    name: 'assert_node_exists',
    description: 'Assert that a node exists (or does not exist) in the RUNNING game\'s scene tree.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'Absolute node path (e.g., "/root/Main/Player").'
        },
        should_exist: {
          type: 'boolean',
          description: 'Whether the node should exist (true) or not exist (false). Default: true.'
        }
      },
      required: ['node_path']
    }
  },
  {
    name: 'wait_for_condition',
    description: 'Poll a property on a running game node until it meets a condition or times out. Useful after input simulation to wait for game state changes. Returns {met: bool, actual, elapsed_sec}.',
    inputSchema: {
      type: 'object',
      properties: {
        node_path: {
          type: 'string',
          description: 'Absolute node path (e.g., "/root/Main/Player").'
        },
        property: {
          type: 'string',
          description: 'Property name (e.g., "position:x", "health").'
        },
        condition: {
          type: 'string',
          description: 'Condition to check.',
          enum: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte']
        },
        value: {
          type: 'string',
          description: 'Target value (as string — parsed to match actual type).'
        },
        timeout_sec: {
          type: 'number',
          description: 'Maximum time to wait in seconds. Default: 5. Capped at (GODOT_MCP_TIMEOUT_MS / 1000 - 5).'
        },
        poll_interval_sec: {
          type: 'number',
          description: 'Polling interval in seconds. Default: 0.1.'
        }
      },
      required: ['node_path', 'property', 'condition', 'value']
    }
  }
];

/**
 * Names of assertion tools — used in server.ts to intercept before invokeTool.
 */
export const assertToolNames = new Set(assertTools.map(t => t.name));

// ── Assertion handler ─────────────────────────────────────────────

export async function handleAssertTool(
  name: string,
  args: Record<string, unknown>,
  bridge: GodotBridge,
  toolTimeoutMs: number
): Promise<unknown> {
  switch (name) {
    case 'assert_property':
      return handleAssertProperty(args, bridge);
    case 'assert_node_exists':
      return handleAssertNodeExists(args, bridge);
    case 'wait_for_condition':
      return handleWaitForCondition(args, bridge, toolTimeoutMs);
    default:
      return { ok: false, error: `Unknown assert tool: ${name}` };
  }
}

async function handleAssertProperty(
  args: Record<string, unknown>,
  bridge: GodotBridge
): Promise<unknown> {
  const nodePath = args.node_path as string;
  const property = args.property as string;
  const expectedStr = args.expected as string;
  const comparator = (args.comparator as string) || 'eq';
  const tolerance = (args.tolerance as number) ?? 0.0001;

  const result = await bridge.invokeTool('game_get_property', {
    node_path: nodePath,
    property
  }) as Record<string, unknown>;

  if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
    return { pass: false, error: (result as Record<string, unknown>).error, node_path: nodePath, property };
  }

  const actual = (result as Record<string, unknown>).value;
  const expected = parseExpected(expectedStr, actual);
  const pass = compare(actual, expected, comparator, tolerance);

  return {
    pass,
    actual,
    expected,
    comparator,
    node_path: nodePath,
    property,
    message: pass
      ? `PASS: ${property} ${comparator} ${expectedStr}`
      : `FAIL: ${property} is ${JSON.stringify(actual)}, expected ${comparator} ${expectedStr}`
  };
}

async function handleAssertNodeExists(
  args: Record<string, unknown>,
  bridge: GodotBridge
): Promise<unknown> {
  const nodePath = args.node_path as string;
  const shouldExist = (args.should_exist as boolean) ?? true;

  // Use game_get_property with a universal property to check existence
  try {
    const result = await bridge.invokeTool('game_get_property', {
      node_path: nodePath,
      property: 'name'
    }) as Record<string, unknown>;

    const exists = result && typeof result === 'object' && result.ok !== false;
    const pass = exists === shouldExist;

    return {
      pass,
      exists,
      should_exist: shouldExist,
      node_path: nodePath,
      message: pass
        ? `PASS: Node ${nodePath} ${shouldExist ? 'exists' : 'does not exist'}`
        : `FAIL: Node ${nodePath} ${exists ? 'exists' : 'does not exist'}, expected ${shouldExist ? 'to exist' : 'not to exist'}`
    };
  } catch {
    // If the tool call fails, the node doesn't exist
    const pass = !shouldExist;
    return {
      pass,
      exists: false,
      should_exist: shouldExist,
      node_path: nodePath,
      message: pass
        ? `PASS: Node ${nodePath} does not exist`
        : `FAIL: Node ${nodePath} does not exist, expected to exist`
    };
  }
}

async function handleWaitForCondition(
  args: Record<string, unknown>,
  bridge: GodotBridge,
  toolTimeoutMs: number
): Promise<unknown> {
  const nodePath = args.node_path as string;
  const property = args.property as string;
  const condition = args.condition as string;
  const valueStr = args.value as string;
  const pollInterval = ((args.poll_interval_sec as number) ?? 0.1) * 1000;

  // Cap timeout to avoid exceeding the MCP tool timeout
  const maxTimeoutSec = Math.max(1, (toolTimeoutMs / 1000) - 5);
  const timeoutSec = Math.min((args.timeout_sec as number) ?? 5, maxTimeoutSec);
  const timeoutMs = timeoutSec * 1000;

  const startTime = Date.now();
  let lastActual: unknown = undefined;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await bridge.invokeTool('game_get_property', {
        node_path: nodePath,
        property
      }) as Record<string, unknown>;

      if (result && result.ok !== false) {
        lastActual = result.value;
        const expected = parseExpected(valueStr, lastActual);

        if (compare(lastActual, expected, condition, 0.0001)) {
          const elapsed = (Date.now() - startTime) / 1000;
          return {
            met: true,
            actual: lastActual,
            expected,
            condition,
            elapsed_sec: Math.round(elapsed * 1000) / 1000,
            node_path: nodePath,
            property,
            message: `Condition met after ${elapsed.toFixed(2)}s: ${property} ${condition} ${valueStr}`
          };
        }
      }
    } catch {
      // Node may not exist yet — keep polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  const elapsed = (Date.now() - startTime) / 1000;
  return {
    met: false,
    actual: lastActual,
    condition,
    expected: valueStr,
    elapsed_sec: Math.round(elapsed * 1000) / 1000,
    timeout_sec: timeoutSec,
    node_path: nodePath,
    property,
    message: `Timeout after ${elapsed.toFixed(2)}s: ${property} is ${JSON.stringify(lastActual)}, expected ${condition} ${valueStr}`
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function parseExpected(expectedStr: string, actual: unknown): unknown {
  if (typeof actual === 'number') {
    const num = Number(expectedStr);
    return isNaN(num) ? expectedStr : num;
  }
  if (typeof actual === 'boolean') {
    return expectedStr === 'true';
  }
  return expectedStr;
}

function compare(
  actual: unknown,
  expected: unknown,
  comparator: string,
  tolerance: number
): boolean {
  switch (comparator) {
    case 'eq': {
      if (typeof actual === 'number' && typeof expected === 'number') {
        return Math.abs(actual - expected) < tolerance;
      }
      return actual === expected;
    }
    case 'neq': {
      if (typeof actual === 'number' && typeof expected === 'number') {
        return Math.abs(actual - expected) >= tolerance;
      }
      return actual !== expected;
    }
    case 'gt':
      return (actual as number) > (expected as number);
    case 'lt':
      return (actual as number) < (expected as number);
    case 'gte':
      return (actual as number) >= (expected as number);
    case 'lte':
      return (actual as number) <= (expected as number);
    case 'contains':
      return String(actual).includes(String(expected));
    case 'matches_regex':
      try {
        return new RegExp(String(expected)).test(String(actual));
      } catch {
        return false;
      }
    default:
      return actual === expected;
  }
}
