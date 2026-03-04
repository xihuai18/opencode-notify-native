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

const shellWrapper = '#!/bin/sh\nexec node "$0.js" "$(basename "$0")" "$@"\n';
const cmdWrapper = '@echo off\r\nnode "%~dpn0.js" "%~n0" %*\r\n';

async function writeWrappedCommand(tmp: string, name: string, script: string) {
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
  else mode = 'plain'
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

  process.env.PATH = `${binDir}${path.delimiter}${prevPath || ""}`;
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

  process.env.PATH = `${binDir}${path.delimiter}${prevPath || ""}`;
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
          title: "Title",
          body: "Body",
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
      assert.match(log[1].args[1], /\nend if$/);
      assert.equal(log[1].env.OC_NOTIFY_TITLE, "Title");
      assert.equal(log[1].env.OC_NOTIFY_BODY, "Body");
      assert.equal(log[1].env.OC_NOTIFY_SOUND, "");
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
      assert.equal(log[1].cmd, "notify-send");
      assert.equal(log[1].mode, "short");
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
      assert.equal(log.length, 3);
      assert.deepEqual(
        log.map((entry) => entry.mode),
        ["long", "short", "plain"],
      );
    } finally {
      restore();
      await cleanupTmpDir(binDir);
    }
  },
);
