/**
 * GodotProcess — spawns and manages a Godot editor process.
 *
 * Used for headless workflows where the MCP server needs to launch Godot
 * autonomously. Spawns `godot --headless -e` and waits for the plugin to
 * connect via WebSocket.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { GodotBridge } from './godot-bridge.js';

const DEFAULT_GODOT_PATH = 'godot';
const DEFAULT_STARTUP_TIMEOUT = 60000; // 60s for first-run asset import
const KILL_GRACE_MS = 5000;
const LOG_RING_SIZE = 100;

export interface GodotProcessOptions {
  projectPath: string;
  headless?: boolean;
  godotPath?: string;
  startupTimeoutMs?: number;
  extraArgs?: string[];
}

export interface GodotProcessStatus {
  running: boolean;
  pid: number | null;
  exitCode: number | null;
  uptimeMs: number | null;
  connected: boolean;
  recentOutput: string[];
}

export class GodotProcess {
  private child: ChildProcess | null = null;
  private startedAt: number | null = null;
  private exitCode: number | null = null;
  private outputRing: string[] = [];
  private godotPath: string;

  constructor(godotPath?: string) {
    this.godotPath = godotPath || process.env.GODOT_PATH || DEFAULT_GODOT_PATH;
  }

  async start(
    bridge: GodotBridge,
    options: GodotProcessOptions
  ): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      if (bridge.isConnected()) {
        return; // Already running and connected
      }
      // Process running but not connected — kill and restart
      await this.stop();
    }

    const {
      projectPath,
      headless = true,
      startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT,
      extraArgs = [],
    } = options;

    const args = ['--path', projectPath, '-e'];
    if (headless) {
      args.push('--headless', '--display-driver', 'headless', '--audio-driver', 'Dummy');
    }
    args.push(...extraArgs);

    this.outputRing = [];
    this.exitCode = null;

    this.log('info', `Spawning: ${this.godotPath} ${args.join(' ')}`);

    this.child = spawn(this.godotPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.startedAt = Date.now();

    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.appendOutput(chunk.toString());
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.appendOutput(chunk.toString());
    });

    this.child.on('error', (err) => {
      this.log('error', `Failed to spawn Godot: ${err.message}`);
      this.child = null;
      this.startedAt = null;
    });

    this.child.on('exit', (code, signal) => {
      this.exitCode = code;
      this.log('info', `Godot exited: code=${code} signal=${signal}`);
      this.child = null;
    });

    // Wait for the plugin to connect via WebSocket
    try {
      const info = await bridge.waitForConnection(startupTimeoutMs);
      this.log('info', `Godot connected: ${info.projectPath || 'unknown project'}`);
    } catch (err) {
      // Timeout — kill the process
      this.log('error', `Godot did not connect within ${startupTimeoutMs}ms — killing process`);
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.child || this.child.exitCode !== null) {
      this.child = null;
      return;
    }

    const pid = this.child.pid;
    this.log('info', `Stopping Godot (PID ${pid})...`);

    this.child.kill('SIGTERM');

    // Wait for graceful exit, then force kill and wait for exit
    await new Promise<void>((resolve) => {
      if (!this.child) {
        resolve();
        return;
      }

      const onExit = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };

      this.child.once('exit', onExit);

      const forceKillTimer = setTimeout(() => {
        if (this.child && this.child.exitCode === null) {
          this.log('warn', `Godot did not exit gracefully — sending SIGKILL`);
          this.child.kill('SIGKILL');
          // Don't resolve here — wait for the 'exit' event after SIGKILL
        }
      }, KILL_GRACE_MS);
    });

    this.child = null;
    this.startedAt = null;
  }

  getStatus(bridge: GodotBridge): GodotProcessStatus {
    const running = this.child !== null && this.child.exitCode === null;
    return {
      running,
      pid: running ? (this.child?.pid ?? null) : null,
      exitCode: this.exitCode,
      uptimeMs: running && this.startedAt ? Date.now() - this.startedAt : null,
      connected: bridge.isConnected(),
      recentOutput: this.outputRing.slice(-20),
    };
  }

  private appendOutput(text: string): void {
    const lines = text.split('\n').filter((l) => l.length > 0);
    for (const line of lines) {
      this.outputRing.push(line);
      if (this.outputRing.length > LOG_RING_SIZE) {
        this.outputRing.shift();
      }
    }
  }

  private log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [GodotProcess] [${level.toUpperCase()}] ${message}`);
  }
}
