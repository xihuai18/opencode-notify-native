import path from "node:path";
import os from "node:os";
import { readFile } from "node:fs/promises";

import type { NotifySound, PluginConfig } from "./types.js";
import { debugWarn } from "./debug.js";
import { isRecord } from "./guards.js";

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  sanitize: true,
  maxBodyLength: 200,
  collapseWindowMs: 3000,
  cooldownMs: 30000,
  showDirectory: false,
  showSessionId: false,
  events: {
    complete: true,
    error: true,
    attention: true,
  },
  soundByEvent: {
    complete: true,
    error: "error",
    attention: "attention",
  },
};

const visibleWarned = new Set<string>();

function displayPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const home = path.resolve(os.homedir());
  const lhs = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const rhs = process.platform === "win32" ? home.toLowerCase() : home;
  if (lhs === rhs || lhs.startsWith(`${rhs}${path.sep}`)) {
    return `~${resolved.slice(home.length)}`;
  }
  const base = path.basename(resolved);
  return base ? `...${path.sep}${base}` : resolved;
}

function visibleWarnOnce(key: string, message: string): void {
  if (visibleWarned.has(key)) return;
  visibleWarned.add(key);
  try {
    process.stderr.write(`[notify-native] Warning: ${message}\n`);
  } catch {
    // Best-effort only.
  }
}

function asBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function asNumber(
  input: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  if (typeof options.min === "number" && input < options.min)
    return options.min;
  if (typeof options.max === "number" && input > options.max)
    return options.max;
  return Math.floor(input);
}

function asSound(input: unknown, fallback: NotifySound): NotifySound {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const value = input.trim();
    if (value.length) return value;
  }
  return fallback;
}

const TOP_LEVEL_KEYS = new Set([
  "enabled",
  "sanitize",
  "maxBodyLength",
  "collapseWindowMs",
  "cooldownMs",
  "showDirectory",
  "showSessionId",
  "events",
  "soundByEvent",
]);

const EVENT_KEYS = new Set(["complete", "error", "attention"]);

function warnUnknownKeys(
  input: Record<string, unknown>,
  valid: Set<string>,
  scope: string,
): void {
  for (const key of Object.keys(input)) {
    if (valid.has(key)) continue;
    visibleWarnOnce(
      `unknown:${scope}:${key}`,
      `unknown config key "${scope}${key}" is ignored`,
    );
  }
}

function mergeConfig(base: PluginConfig, input: unknown): PluginConfig {
  if (!isRecord(input)) return base;
  warnUnknownKeys(input, TOP_LEVEL_KEYS, "");

  const next: PluginConfig = {
    ...base,
    enabled: asBoolean(input.enabled, base.enabled),
    sanitize: asBoolean(input.sanitize, base.sanitize),
    maxBodyLength: asNumber(input.maxBodyLength, base.maxBodyLength, {
      min: 60,
      max: 1200,
    }),
    collapseWindowMs: asNumber(input.collapseWindowMs, base.collapseWindowMs, {
      min: 0,
      max: 10000,
    }),
    cooldownMs: asNumber(input.cooldownMs, base.cooldownMs, {
      min: 0,
      max: 300000,
    }),
    showDirectory: asBoolean(input.showDirectory, base.showDirectory),
    showSessionId: asBoolean(input.showSessionId, base.showSessionId),
    events: { ...base.events },
    soundByEvent: { ...base.soundByEvent },
  };

  if (isRecord(input.events)) {
    warnUnknownKeys(input.events, EVENT_KEYS, "events.");
    next.events.complete = asBoolean(
      input.events.complete,
      next.events.complete,
    );
    next.events.error = asBoolean(input.events.error, next.events.error);
    next.events.attention = asBoolean(
      input.events.attention,
      next.events.attention,
    );
  }

  if (isRecord(input.soundByEvent)) {
    warnUnknownKeys(input.soundByEvent, EVENT_KEYS, "soundByEvent.");
    next.soundByEvent.complete = asSound(
      input.soundByEvent.complete,
      next.soundByEvent.complete,
    );
    next.soundByEvent.error = asSound(
      input.soundByEvent.error,
      next.soundByEvent.error,
    );
    next.soundByEvent.attention = asSound(
      input.soundByEvent.attention,
      next.soundByEvent.attention,
    );
  }

  return next;
}

async function readConfigFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath);

  let decoded: string;
  if (
    content.length >= 3 &&
    content[0] === 0xef &&
    content[1] === 0xbb &&
    content[2] === 0xbf
  ) {
    decoded = content.subarray(3).toString("utf8");
  } else if (
    content.length >= 2 &&
    content[0] === 0xff &&
    content[1] === 0xfe
  ) {
    decoded = content.subarray(2).toString("utf16le");
  } else if (
    content.length >= 2 &&
    content[0] === 0xfe &&
    content[1] === 0xff
  ) {
    const be = content.subarray(2);
    const size = be.length - (be.length % 2);
    const le = Buffer.allocUnsafe(size);
    for (let i = 0; i < size; i += 2) {
      le[i] = be[i + 1];
      le[i + 1] = be[i];
    }
    decoded = le.toString("utf16le");
  } else {
    decoded = content.toString("utf8");
  }

  const withoutBom = decoded.replace(/^\uFEFF/, "");
  return JSON.parse(withoutBom);
}

function resolveConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(path.resolve(xdg), "opencode");

  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) return path.join(path.resolve(appData), "opencode");
  }
  return path.join(os.homedir(), ".config", "opencode");
}

function resolveOverridePath(): string | undefined {
  const value = process.env.OPENCODE_NOTIFY_NATIVE_CONFIG?.trim();
  if (!value) return undefined;
  return path.resolve(value);
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const filePath of paths) {
    const resolved = path.resolve(filePath);
    const key =
      process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(resolved);
  }
  return output;
}

async function readParsedIfExists(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await readConfigFile(filePath);
    if (!isRecord(parsed)) {
      debugWarn(`Ignoring non-object config ${filePath}`);
      return null;
    }
    return parsed;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error &&
      "code" in error &&
      typeof (error as any).code === "string"
        ? String((error as any).code)
        : "";
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    visibleWarnOnce(
      filePath,
      `failed to load config ${displayPath(filePath)}; using lower-precedence/default values`,
    );
    debugWarn(
      `Failed to load config ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function loadPluginConfig(
  worktree: string,
  directory: string,
): Promise<PluginConfig> {
  const configDir = resolveConfigDir();
  const override = resolveOverridePath();

  const layers = dedupePaths([
    path.join(configDir, "notify-native.config.json"),
    path.join(configDir, "opencode-native-notify.config.json"),
    path.join(configDir, "opencode-notify.config.json"),

    path.join(worktree, "notify-native.config.json"),
    path.join(worktree, "opencode-native-notify.config.json"),
    path.join(worktree, "opencode-notify.config.json"),

    path.join(directory, "notify-native.config.json"),
    path.join(directory, "opencode-native-notify.config.json"),
    path.join(directory, "opencode-notify.config.json"),

    path.join(worktree, ".opencode", "notify-native.config.json"),
    path.join(worktree, ".opencode", "opencode-native-notify.config.json"),
    path.join(worktree, ".opencode", "opencode-notify.config.json"),

    path.join(directory, ".opencode", "notify-native.config.json"),
    path.join(directory, ".opencode", "opencode-native-notify.config.json"),
    path.join(directory, ".opencode", "opencode-notify.config.json"),

    ...(override ? [override] : []),
  ]);

  const parsedLayers = await Promise.all(
    layers.map((layer) => readParsedIfExists(layer)),
  );

  let config = defaultPluginConfig();
  for (let i = 0; i < layers.length; i += 1) {
    const parsed = parsedLayers[i];
    if (!parsed) continue;
    config = mergeConfig(config, parsed);
  }
  return config;
}

export function defaultPluginConfig(): PluginConfig {
  return {
    ...DEFAULT_CONFIG,
    events: { ...DEFAULT_CONFIG.events },
    soundByEvent: { ...DEFAULT_CONFIG.soundByEvent },
  };
}
