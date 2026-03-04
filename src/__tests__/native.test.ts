import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  createNativeNotifier,
  escapePango,
  escapeXml,
  macSoundName,
  windowsAudioNode,
} from "../native.js";

async function writeWrappedCommand(tmp: string, name: string, script: string) {
  const nodePathForShell = process.execPath.replace(/"/g, '\\"');
  const nodePathForCmd = process.execPath.replace(/"/g, '""');
  const shellWrapper = `#!/bin/sh\nname=\${0##*/}\nexec "${nodePathForShell}" "$0.js" "$name" "$@"\n`;
  const cmdWrapper = `@echo off\r\n"${nodePathForCmd}" "%~dpn0.js" "%~n0" %*\r\n`;

  await writeFile(path.join(tmp, `${name}.js`), script, "utf8");
  const shellPath = path.join(tmp, name);
  await writeFile(shellPath, shellWrapper, "utf8");
  await writeFile(path.join(tmp, `${name}.cmd`), cmdWrapper, "utf8");
  try {
    await chmod(shellPath, 0o755);
  } catch {
    // Best-effort; Windows does not rely on POSIX executable bits.
  }
}

async function createFakeMacCommands(tmp: string): Promise<void> {
  const recorder = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const cmd = process.argv[2]
const args = process.argv.slice(3)
const env = {
  OC_NOTIFY_TITLE: process.env.OC_NOTIFY_TITLE || '',
  OC_NOTIFY_BODY: process.env.OC_NOTIFY_BODY || '',
  OC_NOTIFY_SOUND: process.env.OC_NOTIFY_SOUND || '',
}
appendFileSync(process.env.OC_TEST_NOTIFY_LOG, JSON.stringify({ cmd, args, env }) + '\\n')
const ok =
  cmd === 'terminal-notifier'
    ? process.env.OC_TEST_TERMINAL_NOTIFIER_OK === '1'
    : process.env.OC_TEST_OSASCRIPT_OK === '1'
process.exit(ok ? 0 : 1)
`;

  await writeWrappedCommand(tmp, "terminal-notifier", recorder);
  await writeWrappedCommand(tmp, "osascript", recorder);
}

async function createFakeLinuxCommands(tmp: string): Promise<void> {
  const recorder = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const cmd = process.argv[2]
const args = process.argv.slice(3)
let mode = ''

if (cmd === 'notify-send') {
  if (args.some((arg) => arg.startsWith('--replace-id='))) mode = 'long'
  else if (args.includes('-r')) mode = 'short'
  else if (args.includes('-a') || args.includes('-u') || args.includes('-t'))
    mode = 'plain'
  else mode = 'minimal'
}

appendFileSync(
  process.env.OC_TEST_NOTIFY_LOG,
  JSON.stringify({ cmd, args, mode }) + '\\n',
)

if (cmd === 'notify-send') {
  const allow = (process.env.OC_TEST_NOTIFY_SEND_OK || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  process.exit(allow.includes(mode) ? 0 : 1)
}

if (cmd === 'canberra-gtk-play') {
  process.exit(process.env.OC_TEST_CANBERRA_OK === '1' ? 0 : 1)
}

process.exit(1)
`;

  await writeWrappedCommand(tmp, "notify-send", recorder);
  await writeWrappedCommand(tmp, "canberra-gtk-play", recorder);
}

async function createFakeWindowsCommands(tmp: string): Promise<void> {
  const recorder = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const cmd = process.argv[2]
const args = process.argv.slice(3)

appendFileSync(process.env.OC_TEST_NOTIFY_LOG, JSON.stringify({ cmd, args }) + '\\n')

if (cmd === 'pwsh') {
  process.exit(process.env.OC_TEST_PWSH_OK === '1' ? 0 : 1)
}

if (cmd === 'powershell') {
  process.exit(process.env.OC_TEST_POWERSHELL_OK === '1' ? 0 : 1)
}

process.exit(1)
`;

  await writeWrappedCommand(tmp, "pwsh", recorder);
  await writeWrappedCommand(tmp, "powershell", recorder);
}

async function readLog(file: string): Promise<any[]> {
  const content = await readFile(file, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function awaitWithKeepAlive<T>(promise: Promise<T>): Promise<T> {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    return await promise;
  } finally {
    clearInterval(keepAlive);
  }
}

async function cleanupTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

async function waitForLogCount(
  file: string,
  count: number,
  timeoutMs = 1500,
): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = await readLog(file);
    if (log.length >= count) return log;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readLog(file);
}

async function setupMacEnv(
  binDir: string,
  logFile: string,
  options: {
    terminalNotifierOk: "0" | "1";
    osascriptOk: "0" | "1";
  },
): Promise<() => void> {
  const prevPath = process.env.PATH;
  const prevLog = process.env.OC_TEST_NOTIFY_LOG;
  const prevTn = process.env.OC_TEST_TERMINAL_NOTIFIER_OK;
  const prevOsa = process.env.OC_TEST_OSASCRIPT_OK;
  const prevPlatform = process.platform;

  process.env.PATH = binDir;
  process.env.OC_TEST_NOTIFY_LOG = logFile;
  process.env.OC_TEST_TERMINAL_NOTIFIER_OK = options.terminalNotifierOk;
  process.env.OC_TEST_OSASCRIPT_OK = options.osascriptOk;
  Object.defineProperty(process, "platform", { value: "darwin" });

  return () => {
    Object.defineProperty(process, "platform", { value: prevPlatform });
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevLog === undefined) delete process.env.OC_TEST_NOTIFY_LOG;
    else process.env.OC_TEST_NOTIFY_LOG = prevLog;
    if (prevTn === undefined) delete process.env.OC_TEST_TERMINAL_NOTIFIER_OK;
    else process.env.OC_TEST_TERMINAL_NOTIFIER_OK = prevTn;
    if (prevOsa === undefined) delete process.env.OC_TEST_OSASCRIPT_OK;
    else process.env.OC_TEST_OSASCRIPT_OK = prevOsa;
  };
}

async function setupLinuxEnv(
  binDir: string,
  logFile: string,
  options: {
    notifySendOk: string;
    canberraOk: "0" | "1";
  },
): Promise<() => void> {
  const prevPath = process.env.PATH;
  const prevLog = process.env.OC_TEST_NOTIFY_LOG;
  const prevNotifySendOk = process.env.OC_TEST_NOTIFY_SEND_OK;
  const prevCanberra = process.env.OC_TEST_CANBERRA_OK;
  const prevPlatform = process.platform;

  process.env.PATH = binDir;
  process.env.OC_TEST_NOTIFY_LOG = logFile;
  process.env.OC_TEST_NOTIFY_SEND_OK = options.notifySendOk;
  process.env.OC_TEST_CANBERRA_OK = options.canberraOk;
  Object.defineProperty(process, "platform", { value: "linux" });

  return () => {
    Object.defineProperty(process, "platform", { value: prevPlatform });
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevLog === undefined) delete process.env.OC_TEST_NOTIFY_LOG;
    else process.env.OC_TEST_NOTIFY_LOG = prevLog;
    if (prevNotifySendOk === undefined)
      delete process.env.OC_TEST_NOTIFY_SEND_OK;
    else process.env.OC_TEST_NOTIFY_SEND_OK = prevNotifySendOk;
    if (prevCanberra === undefined) delete process.env.OC_TEST_CANBERRA_OK;
    else process.env.OC_TEST_CANBERRA_OK = prevCanberra;
  };
}

async function setupWindowsEnv(
  binDir: string,
  logFile: string,
  options: {
    pwshOk: "0" | "1";
    powershellOk: "0" | "1";
  },
): Promise<() => void> {
  const prevPath = process.env.PATH;
  const prevLog = process.env.OC_TEST_NOTIFY_LOG;
  const prevPwsh = process.env.OC_TEST_PWSH_OK;
  const prevPowerShell = process.env.OC_TEST_POWERSHELL_OK;
  const prevPlatform = process.platform;

  process.env.PATH = binDir;
  process.env.OC_TEST_NOTIFY_LOG = logFile;
  process.env.OC_TEST_PWSH_OK = options.pwshOk;
  process.env.OC_TEST_POWERSHELL_OK = options.powershellOk;
  Object.defineProperty(process, "platform", { value: "win32" });

  return () => {
    Object.defineProperty(process, "platform", { value: prevPlatform });
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevLog === undefined) delete process.env.OC_TEST_NOTIFY_LOG;
    else process.env.OC_TEST_NOTIFY_LOG = prevLog;
    if (prevPwsh === undefined) delete process.env.OC_TEST_PWSH_OK;
    else process.env.OC_TEST_PWSH_OK = prevPwsh;
    if (prevPowerShell === undefined) delete process.env.OC_TEST_POWERSHELL_OK;
    else process.env.OC_TEST_POWERSHELL_OK = prevPowerShell;
  };
}

test("escapeXml escapes XML special characters", () => {
  const input = `a&b<c>d"e'f`;
  const out = escapeXml(input);
  assert.equal(out, "a&amp;b&lt;c&gt;d&quot;e&apos;f");
});

test("escapePango escapes Pango markup characters", () => {
  const input = "a&b<c>d";
  const out = escapePango(input);
  assert.equal(out, "a&amp;b&lt;c&gt;d");
});

test("windowsAudioNode maps boolean and named sounds", () => {
  assert.match(windowsAudioNode(false), /silent="true"/);
  assert.match(windowsAudioNode(true), /Notification\.Default/);
  assert.match(windowsAudioNode("attention"), /Notification\.SMS/);
  assert.match(windowsAudioNode("error"), /Notification\.Reminder/);
  assert.match(
    windowsAudioNode("ms-winsoundevent:Notification.Default"),
    /ms-winsoundevent:Notification\.Default/,
  );
});

test("macSoundName maps boolean and named sounds", () => {
  assert.equal(macSoundName("error", true), "Basso");
  assert.equal(macSoundName("attention", true), "Glass");
  assert.equal(macSoundName("complete", true), "Funk");

  assert.equal(macSoundName("complete", "attention"), "Glass");
  assert.equal(macSoundName("complete", "error"), "Basso");
  assert.equal(macSoundName("complete", "Ping"), "Ping");
});

test(
  "windows notifier falls back from pwsh to powershell",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeWindowsCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupWindowsEnv(binDir, logFile, {
      pwshOk: "0",
      powershellOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "attention",
          sound: true,
          group: "windows-fallback",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 2);
      assert.equal(log[0].cmd, "pwsh");
      assert.equal(log[1].cmd, "powershell");

      const commandIdx = log[1].args.indexOf("-Command");
      assert.ok(commandIdx >= 0);
      const script = String(log[1].args[commandIdx + 1] || "");
      assert.match(script, /History\.GetHistory/);
      assert.doesNotMatch(script, /-match \"posted\"/);
      assert.doesNotMatch(script, /-match \"publish\"/);
      assert.doesNotMatch(script, /发布/);
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "windows notifier uses pwsh when available",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeWindowsCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupWindowsEnv(binDir, logFile, {
      pwshOk: "1",
      powershellOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: true,
          group: "windows-primary",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 1);
      assert.equal(log[0].cmd, "pwsh");
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "windows notifier prefers powershell when pwsh is missing",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeWindowsCommands(binDir);
    await Promise.allSettled([
      unlink(path.join(binDir, "pwsh")),
      unlink(path.join(binDir, "pwsh.cmd")),
    ]);
    await writeFile(logFile, "", "utf8");
    const restore = await setupWindowsEnv(binDir, logFile, {
      pwshOk: "0",
      powershellOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: true,
          group: "windows-missing-pwsh",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 1);
      assert.equal(log[0].cmd, "powershell");
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "darwin notifier uses terminal-notifier when available",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeMacCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupMacEnv(binDir, logFile, {
      terminalNotifierOk: "1",
      osascriptOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "attention",
          sound: true,
          group: "mac-group",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 1);
      assert.equal(log[0].cmd, "terminal-notifier");
      assert.ok(log[0].args.includes("-sound"));
      assert.ok(log[0].args.includes("Glass"));
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "darwin notifier falls back to osascript and respects sound false",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeMacCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupMacEnv(binDir, logFile, {
      terminalNotifierOk: "0",
      osascriptOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "OpenCode · 测试",
          body: "Body · 任务完成",
          event: "error",
          sound: false,
          group: `\u0000${"x".repeat(300)}\u001f`,
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 2);
      assert.equal(log[0].cmd, "terminal-notifier");
      assert.ok(!log[0].args.includes("-sound"));
      const groupIdx = log[0].args.indexOf("-group");
      assert.ok(groupIdx >= 0);
      assert.equal(log[0].args[groupIdx + 1].length, 200);

      assert.equal(log[1].cmd, "osascript");
      assert.equal(log[1].args[0], "-e");
      assert.match(log[1].args[1], /\nend run$/);
      assert.equal(log[1].args[2], "--");
      assert.equal(log[1].args[3], "OpenCode · 测试");
      assert.equal(log[1].args[4], "Body · 任务完成");
      assert.equal(log[1].args[5], "");
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "darwin notifier falls back when terminal-notifier is missing",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeMacCommands(binDir);
    await Promise.allSettled([
      unlink(path.join(binDir, "terminal-notifier")),
      unlink(path.join(binDir, "terminal-notifier.cmd")),
    ]);
    await writeFile(logFile, "", "utf8");
    const restore = await setupMacEnv(binDir, logFile, {
      terminalNotifierOk: "1",
      osascriptOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: true,
          group: "group-missing-tn",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 1);
      assert.equal(log[0].cmd, "osascript");
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "darwin notifier backs off after repeated backend failures",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeMacCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupMacEnv(binDir, logFile, {
      terminalNotifierOk: "0",
      osascriptOk: "0",
    });

    try {
      const notify = createNativeNotifier();
      const first = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: true,
        }),
      );
      const second = await awaitWithKeepAlive(
        notify({
          title: "Title2",
          body: "Body2",
          event: "complete",
          sound: true,
        }),
      );

      assert.equal(first, false);
      assert.equal(second, false);

      const log = await readLog(logFile);
      assert.equal(log.length, 2);
      assert.equal(log[0].cmd, "terminal-notifier");
      assert.equal(log[1].cmd, "osascript");
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "linux notifier falls back from long to short mode",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeLinuxCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupLinuxEnv(binDir, logFile, {
      notifySendOk: "short",
      canberraOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "attention",
          sound: false,
          group: "linux-group",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 2);
      assert.equal(log[0].cmd, "notify-send");
      assert.equal(log[0].mode, "long");
      assert.ok(log[0].args.includes("--"));
      assert.equal(log[1].cmd, "notify-send");
      assert.equal(log[1].mode, "short");
      assert.ok(log[1].args.includes("--"));
      assert.ok(!log[1].args.includes("-h"));
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "linux notifier falls back to plain mode",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeLinuxCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupLinuxEnv(binDir, logFile, {
      notifySendOk: "plain",
      canberraOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: false,
          group: "linux-group-plain",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 3);
      assert.deepEqual(
        log.map((entry) => entry.mode),
        ["long", "short", "plain"],
      );
      assert.ok(log[2].args.includes("--"));
      assert.ok(!log[2].args.includes("-h"));
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "linux notifier falls back to minimal mode",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeLinuxCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupLinuxEnv(binDir, logFile, {
      notifySendOk: "minimal",
      canberraOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "complete",
          sound: false,
          group: "linux-group-minimal",
        }),
      );
      assert.equal(ok, true);

      const log = await readLog(logFile);
      assert.equal(log.length, 4);
      assert.deepEqual(
        log.map((entry) => entry.mode),
        ["long", "short", "plain", "minimal"],
      );
      assert.ok(!log[3].args.includes("--"));
      assert.deepEqual(log[3].args, ["Title", "Body"]);
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "linux notifier triggers canberra sound when enabled",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeLinuxCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupLinuxEnv(binDir, logFile, {
      notifySendOk: "long",
      canberraOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const ok = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "error",
          sound: true,
          group: "linux-sound",
        }),
      );
      assert.equal(ok, true);

      const log = await waitForLogCount(logFile, 2);
      const canberra = log.find((entry) => entry.cmd === "canberra-gtk-play");
      assert.ok(canberra);
      assert.deepEqual(canberra.args, ["-i", "dialog-error"]);
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);

test(
  "linux notifier backs off after notify-send failures",
  { concurrency: false },
  async () => {
    const binDir = await mkdtemp(path.join(os.tmpdir(), "notify-native-bin-"));
    const logFile = path.join(binDir, "notify.log");
    await createFakeLinuxCommands(binDir);
    await writeFile(logFile, "", "utf8");
    const restore = await setupLinuxEnv(binDir, logFile, {
      notifySendOk: "",
      canberraOk: "1",
    });

    try {
      const notify = createNativeNotifier();
      const first = await awaitWithKeepAlive(
        notify({
          title: "Title",
          body: "Body",
          event: "attention",
          sound: false,
          group: "linux-backoff",
        }),
      );
      const second = await awaitWithKeepAlive(
        notify({
          title: "Title2",
          body: "Body2",
          event: "attention",
          sound: false,
          group: "linux-backoff",
        }),
      );

      assert.equal(first, false);
      assert.equal(second, false);

      const log = await readLog(logFile);
      assert.equal(log.length, 4);
      assert.deepEqual(
        log.map((entry) => entry.mode),
        ["long", "short", "plain", "minimal"],
      );
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);
