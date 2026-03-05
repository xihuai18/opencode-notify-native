import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { backendBackoffMs } from "./backoff.js";
import { debugEnabled, debugWarn } from "./debug.js";
import { fnv1a32 } from "./hash.js";
import type { NotifyEventType, NotifySound } from "./types.js";

// Captured at module-load time, before any test-level overrides of
// process.platform.  Used exclusively to decide whether spawn() needs
// cmd.exe to resolve PATHEXT (.cmd / .bat) wrappers.
const hostPlatform: NodeJS.Platform = process.platform;

function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

const visibleWarned = new Set<string>();

function visibleWarnOnce(key: string, message: string): void {
  if (visibleWarned.has(key)) return;
  visibleWarned.add(key);
  try {
    process.stderr.write(`[notify-native] Warning: ${message}\n`);
  } catch {
    // Best-effort only.
  }
}

export function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function escapePango(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hashHex(input: string, length: number): string {
  return createHash("sha256")
    .update(input, "utf8")
    .digest("hex")
    .slice(0, length);
}

function windowsNotifierAppIds(): string[] {
  const requestedSender = stripControlChars(
    process.env.OPENCODE_NOTIFY_NATIVE_WINDOWS_SENDER || "",
  ).toLowerCase();
  if (requestedSender !== "terminal") {
    return ["Microsoft.Windows.Explorer"];
  }

  // Terminal sender is opt-in because some setups can foreground Terminal on click.
  return [
    "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App",
    "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe!App",
    "Microsoft.WindowsTerminalCanary_8wekyb3d8bbwe!App",
    "Microsoft.Windows.Explorer",
  ];
}

async function resolveCommandInPath(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const pathValue = env.PATH || env.Path || "";
  if (!pathValue) return null;

  const dirs = pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!dirs.length) return null;

  const names = [command];
  if (process.platform === "win32" && !path.extname(command)) {
    const extList = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const ext of extList) {
      const normalized = ext.startsWith(".") ? ext : `.${ext}`;
      names.push(`${command}${normalized.toLowerCase()}`);
      names.push(`${command}${normalized.toUpperCase()}`);
    }
  }

  for (const rawDir of dirs) {
    // Some Windows setups include quoted PATH entries (rare but valid).
    const dir = rawDir.replace(/^"|"$/g, "");
    for (const name of names) {
      try {
        await access(
          path.join(dir, name),
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return path.join(dir, name);
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null;
}

type RunOptions = {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  captureStderr?: boolean;
};

type RunResult = {
  ok: boolean;
  stderr: string;
};

function runDetailed(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const captureStderr = options.captureStderr || debugEnabled();
    let child: ReturnType<typeof spawn>;
    let stderrOutput = "";
    try {
      // On native Windows, .cmd/.bat wrappers (common for shims, test fakes,
      // and package-manager-installed binaries) cannot be launched by
      // CreateProcessW.  Spawning through cmd.exe lets PATHEXT resolution
      // work correctly.  We gate on the *host* platform (captured at module
      // load) so that cross-platform test overrides of process.platform do
      // not accidentally invoke cmd.exe on Unix.
      //
      // When the resolved command path contains spaces (e.g.
      // "C:\Program Files\..."), we pre-quote it so cmd.exe treats it as a
      // single token after /s strips the outermost quotes.
      const spawnViaShell = hostPlatform === "win32";
      const spawnCommand =
        spawnViaShell && command.includes(" ") ? `"${command}"` : command;

      child = spawn(spawnCommand, args, {
        stdio: ["ignore", "ignore", captureStderr ? "pipe" : "ignore"],
        windowsHide: true,
        shell: spawnViaShell || undefined,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
    } catch (error) {
      visibleWarnOnce(
        `spawn:${command}`,
        `failed to start ${command}; native notifications may be unavailable`,
      );
      debugWarn(
        `Failed to spawn ${command}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      resolve({ ok: false, stderr: "" });
      return;
    }
    // Best-effort: do not keep OpenCode running just to finish a notification.
    child.unref?.();

    if (captureStderr && child.stderr) {
      child.stderr.on("data", (chunk) => {
        if (stderrOutput.length >= 4096) return;
        stderrOutput += String(chunk);
      });
    }

    let done = false;
    let exited = false;
    let hardKill: NodeJS.Timeout | undefined;

    const settle = (result: RunResult): void => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            if (done) return;
            try {
              child.kill();
            } catch (error) {
              debugWarn(
                `Failed to terminate process ${command}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            hardKill = setTimeout(() => {
              if (exited || child.exitCode !== null) return;
              try {
                child.kill("SIGKILL");
              } catch (error) {
                debugWarn(
                  `Failed to force-kill process ${command}: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              }
            }, 250);
            hardKill.unref?.();
            settle({ ok: false, stderr: stderrOutput });
          }, options.timeoutMs)
        : undefined;

    timer?.unref?.();

    const logStderrIfAny = (): void => {
      if (!captureStderr) return;
      const message = stderrOutput.trim();
      if (!message) return;
      debugWarn(`${command} stderr: ${message.slice(0, 2048)}`);
    };

    child.on("error", () => {
      exited = true;
      if (timer) clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      logStderrIfAny();
      settle({ ok: false, stderr: stderrOutput });
    });
    child.on("close", (code) => {
      exited = true;
      if (timer) clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      if (code !== 0) logStderrIfAny();
      settle({ ok: code === 0, stderr: stderrOutput });
    });
  });
}

function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<boolean> {
  return runDetailed(command, args, options).then((result) => result.ok);
}

function normalizeSound(
  event: NotifyEventType,
  sound: NotifySound,
): boolean | string {
  if (typeof sound === "boolean") return sound;
  if (typeof sound === "string") {
    const value = stripControlChars(sound).slice(0, 200);
    if (value) return value;
  }
  if (event === "complete") return true;
  if (event === "error") return "error";
  return "attention";
}

type BackendState = {
  linuxNotifySendDisabledUntil: number;
  linuxNotifySendFailures: number;
  linuxNotifySendMode: "auto" | "long" | "short" | "plain" | "minimal";
  windowsNotifyDisabledUntil: number;
  windowsNotifyFailures: number;
  windowsPreferredShell: "" | "pwsh" | "powershell";
  macNotifyDisabledUntil: number;
  macNotifyFailures: number;
  linuxCanberraDisabledUntil: number;
  linuxCanberraFailures: number;
  linuxCanberraInFlight: boolean;
};

function createBackendState(): BackendState {
  return {
    linuxNotifySendDisabledUntil: 0,
    linuxNotifySendFailures: 0,
    linuxNotifySendMode: "auto",
    windowsNotifyDisabledUntil: 0,
    windowsNotifyFailures: 0,
    windowsPreferredShell: "",
    macNotifyDisabledUntil: 0,
    macNotifyFailures: 0,
    linuxCanberraDisabledUntil: 0,
    linuxCanberraFailures: 0,
    linuxCanberraInFlight: false,
  };
}

export function windowsAudioNode(sound: boolean | string): string {
  if (sound === false) return '<audio silent="true"/>';
  if (sound === true) {
    return '<audio src="ms-winsoundevent:Notification.Default"/>';
  }
  if (typeof sound === "string") {
    if (sound.startsWith("ms-winsoundevent:")) {
      return `<audio src="${escapeXml(sound)}"/>`;
    }
    if (sound === "attention") {
      return '<audio src="ms-winsoundevent:Notification.SMS"/>';
    }
    if (sound === "error") {
      return '<audio src="ms-winsoundevent:Notification.Reminder"/>';
    }
    return '<audio src="ms-winsoundevent:Notification.Default"/>';
  }
  return "";
}

function windowsTextNodes(title: string, body: string): string {
  const bodyLines = body
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);

  const lines = bodyLines.length ? bodyLines : [body];
  return `<text>${escapeXml(title)}</text>${lines
    .map((line) => `<text>${escapeXml(line)}</text>`)
    .join("")}`;
}

export function macSoundName(
  event: NotifyEventType,
  sound: boolean | string,
): string {
  if (sound === true) {
    if (event === "error") return "Basso";
    if (event === "attention") return "Glass";
    return "Funk";
  }
  if (typeof sound === "string") {
    if (sound === "attention") return "Glass";
    if (sound === "error") return "Basso";
    return sound;
  }
  return "";
}

async function notifyWindows(
  state: BackendState,
  title: string,
  body: string,
  sound: boolean | string,
  group: string,
): Promise<boolean> {
  const now = Date.now();
  if (now < state.windowsNotifyDisabledUntil) return false;

  // Explorer remains the default sender to preserve no-op click behavior.
  // Terminal sender branding is available via explicit env opt-in.
  const notifierAppIds = windowsNotifierAppIds();

  const toastGroup = "opencode-notify";
  // Tag length limits vary across Windows versions; 16 chars is the safest.
  const toastTag = hashHex(group, 16);
  // Use background activation with empty launch payload to keep click no-op.
  const xml = `<toast activationType="background" launch=""><visual><binding template="ToastGeneric">${windowsTextNodes(
    title,
    body,
  )}</binding></visual>${windowsAudioNode(sound)}</toast>`;
  const encoded = Buffer.from(xml, "utf8").toString("base64");
  const appIds = notifierAppIds
    .map((id) => `'${id.replace(/'/g, "''")}'`)
    .join(", ");

  const script = [
    "$bytes = [Convert]::FromBase64String('" + encoded + "')",
    "$xmlString = [Text.Encoding]::UTF8.GetString($bytes)",
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null",
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "$xml.LoadXml($xmlString)",
    "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
    `$toastTag = '${toastTag}'`,
    `$toastGroup = '${toastGroup}'`,
    "$toast.Tag = $toastTag",
    "$toast.Group = $toastGroup",
    `$appIds = @(${appIds})`,
    "$shown = $false",
    // Verify each sender by history when possible, but trust Show() when
    // history APIs are unavailable.
    "foreach ($appId in $appIds) { if ($shown) { break }; $showAttempted = $false; try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast); $showAttempted = $true } catch {} ; try { $history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId); foreach ($item in $history) { if ($item.Tag -eq $toastTag -and $item.Group -eq $toastGroup) { $shown = $true; break } } } catch {} ; if (-not $shown -and $showAttempted) { $shown = $true } }",
    "if (-not $shown) { $showAttempted = $false; try { [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier().Show($toast); $showAttempted = $true } catch {} ; try { $history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory(); foreach ($item in $history) { if ($item.Tag -eq $toastTag -and $item.Group -eq $toastGroup) { $shown = $true; break } } } catch {} ; if (-not $shown -and $showAttempted) { $shown = $true } }",
    "if (-not $shown) { throw 'ToastNotificationManager failed to show toast' }",
  ].join("; ");

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    // -EncodedCommand accepts a base64-encoded UTF-16LE string.  This
    // avoids all cmd.exe metacharacter issues (the script contains "> $null",
    // parentheses, pipes, etc.) that would break with shell: true + -Command.
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
  type ShellKind = "pwsh" | "powershell";
  type ShellCandidate = { kind: ShellKind; command: string };

  const resolveShell = async (kind: ShellKind): Promise<ShellCandidate> => {
    const resolved = await resolveCommandInPath(kind, process.env);
    // On Windows, "powershell" is often found via system directories before
    // PATH. When we want a PATH override (tests, custom shims), spawning the
    // resolved full path is the only deterministic option.
    return { kind, command: resolved || kind };
  };

  let shells: ShellCandidate[];
  if (state.windowsPreferredShell) {
    const first = state.windowsPreferredShell;
    const second: ShellKind = first === "pwsh" ? "powershell" : "pwsh";
    shells = await Promise.all([resolveShell(first), resolveShell(second)]);
  } else {
    const [pwsh, powershell] = await Promise.all([
      resolveShell("pwsh"),
      resolveShell("powershell"),
    ]);

    const hasPwsh = pwsh.command !== "pwsh";
    const hasPowershell = powershell.command !== "powershell";

    // If PATH lookups fail, still attempt both: one may be reachable via
    // system search paths or app execution aliases.
    if (hasPwsh && hasPowershell) shells = [pwsh, powershell];
    else if (hasPwsh) shells = [pwsh];
    else if (hasPowershell) shells = [powershell];
    else shells = [pwsh, powershell];
  }

  let ok = false;
  for (const shell of shells) {
    ok = await run(shell.command, args, { timeoutMs: 8_000 });
    if (ok) {
      state.windowsPreferredShell = shell.kind;
      break;
    }
  }

  if (ok) {
    state.windowsNotifyFailures = 0;
    state.windowsNotifyDisabledUntil = 0;
  } else {
    state.windowsNotifyFailures += 1;
    state.windowsNotifyDisabledUntil =
      now + backendBackoffMs(state.windowsNotifyFailures);
  }
  return ok;
}

async function notifyMac(
  state: BackendState,
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  _group: string,
): Promise<boolean> {
  const now = Date.now();
  if (now < state.macNotifyDisabledUntil) return false;

  const mapped = macSoundName(event, sound);

  const script = [
    "on run argv",
    'set t to ""',
    'set b to ""',
    'set s to ""',
    "if (count of argv) >= 1 then set t to item 1 of argv",
    "if (count of argv) >= 2 then set b to item 2 of argv",
    "if (count of argv) >= 3 then set s to item 3 of argv",
    'if s is not "" then',
    "  display notification b with title t sound name s",
    "else",
    "  display notification b with title t",
    "end if",
    "end run",
  ].join("\n");

  // `system attribute` decodes UTF-8 environment values incorrectly on many
  // macOS setups. Pass user text via argv to preserve Unicode.
  // `_group` is intentionally ignored: AppleScript notifications do not
  // support backend-level replace/group semantics.
  // `display notification` does not expose click-action controls.
  // We keep behavior best-effort by not registering any open/activate action.
  const ok = await run(
    "osascript",
    ["-e", script, "--", title, body, sound === false ? "" : mapped],
    { timeoutMs: 8000 },
  );

  if (ok) {
    state.macNotifyFailures = 0;
    state.macNotifyDisabledUntil = 0;
  } else {
    state.macNotifyFailures += 1;
    state.macNotifyDisabledUntil =
      now + backendBackoffMs(state.macNotifyFailures);
  }
  return ok;
}

async function notifyLinux(
  state: BackendState,
  title: string,
  body: string,
  event: NotifyEventType,
  sound: boolean | string,
  group: string,
): Promise<boolean> {
  const now = Date.now();
  const urgency =
    event === "error" ? "critical" : event === "attention" ? "normal" : "low";
  const timeoutMs =
    event === "error" ? 12_000 : event === "attention" ? 10_000 : 4_000;
  const replaceId = fnv1a32(group) & 0x7fffffff || 1;

  const safeTitle = escapePango(title);
  const safeBody = escapePango(body);

  const args = [
    "-a",
    "opencode",
    "-u",
    urgency,
    "-t",
    String(timeoutMs),
    `--replace-id=${replaceId}`,
    "-h",
    `string:x-canonical-private-synchronous:opencode-${replaceId}`,
    "-h",
    `string:x-dunst-stack-tag:opencode-${replaceId}`,
    "--",
    safeTitle,
    safeBody,
  ];

  // Some notify-send builds only support a subset of replacement flags.
  // Keep short mode free of custom hints so it works on stricter variants.
  const shortArgs = [
    "-a",
    "opencode",
    "-u",
    urgency,
    "-t",
    String(timeoutMs),
    "-r",
    String(replaceId),
    "--",
    safeTitle,
    safeBody,
  ];
  const plainArgs = [
    "-a",
    "opencode",
    "-u",
    urgency,
    "-t",
    String(timeoutMs),
    "--",
    safeTitle,
    safeBody,
  ];
  const minimalArgs = [safeTitle, safeBody];

  const modeArgs = {
    long: args,
    short: shortArgs,
    plain: plainArgs,
    minimal: minimalArgs,
  };

  const fallbackModes: Array<"long" | "short" | "plain" | "minimal"> = [
    "long",
    "short",
    "plain",
    "minimal",
  ];
  const modes =
    state.linuxNotifySendMode === "auto"
      ? fallbackModes
      : [
          state.linuxNotifySendMode,
          ...fallbackModes.filter((m) => m !== state.linuxNotifySendMode),
        ];

  const notifySendTimeoutMs = 2500;
  let ok = false;
  if (now >= state.linuxNotifySendDisabledUntil) {
    for (const mode of modes) {
      ok = await run("notify-send", modeArgs[mode], {
        timeoutMs: notifySendTimeoutMs,
      });
      if (ok) {
        state.linuxNotifySendMode = mode;
        break;
      }
    }

    if (ok) {
      state.linuxNotifySendFailures = 0;
      state.linuxNotifySendDisabledUntil = 0;
    } else {
      state.linuxNotifySendFailures += 1;
      state.linuxNotifySendDisabledUntil =
        now + backendBackoffMs(state.linuxNotifySendFailures);
    }
  }

  if (!ok || sound === false) return ok;
  const soundId =
    typeof sound === "string" && sound !== "attention" && sound !== "error"
      ? stripControlChars(sound).slice(0, 200) || "message-new-instant"
      : event === "error"
        ? "dialog-error"
        : event === "attention"
          ? "dialog-warning"
          : "message-new-instant";

  if (now < state.linuxCanberraDisabledUntil) return ok;
  if (state.linuxCanberraInFlight) {
    debugWarn(
      "Skipping canberra-gtk-play because a previous sound is in flight",
    );
    return ok;
  }

  state.linuxCanberraInFlight = true;
  void run("canberra-gtk-play", ["-i", soundId], { timeoutMs: 2000 })
    .then((played) => {
      if (played) {
        state.linuxCanberraFailures = 0;
        state.linuxCanberraDisabledUntil = 0;
        return;
      }
      state.linuxCanberraFailures += 1;
      state.linuxCanberraDisabledUntil =
        Date.now() + backendBackoffMs(state.linuxCanberraFailures);
    })
    .catch((error) => {
      debugWarn(
        `canberra-gtk-play failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => {
      state.linuxCanberraInFlight = false;
    });
  return ok;
}

export function createNativeNotifier() {
  const state = createBackendState();

  return async function notifyNativeFallback(input: {
    title: string;
    body: string;
    event: NotifyEventType;
    sound: NotifySound;
    group?: string;
  }): Promise<boolean> {
    const sound = normalizeSound(input.event, input.sound);
    const groupValue =
      typeof input.group === "string" ? stripControlChars(input.group) : "";
    const group = groupValue ? groupValue.slice(0, 200) : "opencode-notify";

    if (process.platform === "win32") {
      return notifyWindows(state, input.title, input.body, sound, group);
    }
    if (process.platform === "darwin") {
      return notifyMac(
        state,
        input.title,
        input.body,
        input.event,
        sound,
        group,
      );
    }
    if (process.platform === "linux") {
      return notifyLinux(
        state,
        input.title,
        input.body,
        input.event,
        sound,
        group,
      );
    }
    return false;
  };
}
