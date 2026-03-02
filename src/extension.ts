import * as vscode from "vscode"
import { spawn } from "node:child_process"

const QUEUE_RELATIVE_PATH = ".opencode/opencode-notify.queue.jsonl"
const STATUS_RELATIVE_PATH = ".opencode/opencode-notify.status.json"
const OFFSETS_STATE_KEY = "opencodeNotify.offsets.v1"
const MAX_QUEUE_BYTES = 1024 * 1024

type NotifyEventType = "complete" | "error" | "attention"

type QueueEntry = {
  v: 1
  ts: string
  event: NotifyEventType
  title: string
  body: string
  jumpUri?: string
  ppid?: number
  worktree?: string
  directory?: string
  origin?: string
  sound?: boolean | string
  count?: number
}

type CommandResult = {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

type Capabilities = {
  platform: NodeJS.Platform
  notifySend: boolean
  notifySendActions: boolean
  terminalNotifier: boolean
}

function normalizePath(input: string): string {
  const slash = input.replace(/\\/g, "/").replace(/\/+$/, "")
  if (process.platform === "win32") return slash.toLowerCase()
  return slash
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function toStringValue(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined
  const value = input.trim()
  return value.length ? value : undefined
}

function toNumberValue(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input)) return undefined
  return Math.floor(input)
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function appleQuote(input: string): string {
  return `\"${input.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')}\"`
}

function mapSoundToken(
  event: NotifyEventType,
  sound: boolean | string | undefined,
): boolean | string {
  if (typeof sound === "boolean") return sound
  if (typeof sound === "string") return sound
  if (event === "complete") return true
  if (event === "error") return "error"
  return "attention"
}

function toLinuxSoundName(sound: boolean | string): string | undefined {
  if (sound === false) return undefined
  if (sound === "attention") return "bell"
  if (sound === "error") return "dialog-error"
  if (sound === true) return undefined
  if (typeof sound !== "string") return undefined
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(sound)) return undefined
  return sound
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    let done = false

    const timer =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? setTimeout(() => {
            if (done) return
            done = true
            child.kill()
            resolve({ ok: false, code: null, stdout, stderr: "timeout" })
          }, options.timeoutMs)
        : undefined

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (error) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: error.message,
      })
    })
    child.on("close", (code) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      })
    })
  })
}

function parseQueueEntry(line: string): QueueEntry | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null

  const version = toNumberValue(parsed.v)
  if (version !== 1) return null

  const title = toStringValue(parsed.title)
  const body = toStringValue(parsed.body)
  const event = toStringValue(parsed.event) as NotifyEventType | undefined
  if (!title || !body || !event) return null
  if (event !== "complete" && event !== "error" && event !== "attention") {
    return null
  }

  const jumpUri = toStringValue(parsed.jumpUri)
  const ppid = toNumberValue(parsed.ppid)
  const count = toNumberValue(parsed.count)

  return {
    v: 1,
    ts: toStringValue(parsed.ts) || new Date().toISOString(),
    event,
    title,
    body,
    jumpUri,
    ppid,
    worktree: toStringValue(parsed.worktree),
    directory: toStringValue(parsed.directory),
    origin: toStringValue(parsed.origin),
    sound:
      typeof parsed.sound === "boolean" || typeof parsed.sound === "string"
        ? parsed.sound
        : undefined,
    count,
  }
}

function sanitizeJumpUri(input: string | undefined, extensionID: string): string | undefined {
  if (!input) return undefined
  try {
    const uri = vscode.Uri.parse(input, true)
    if (uri.scheme !== "vscode") return undefined
    if (uri.authority !== extensionID) return undefined
    if (uri.path !== "/opencode-jump") return undefined
    return uri.toString()
  } catch {
    return undefined
  }
}

class NotifyExtension implements vscode.UriHandler {
  private readonly offsets = new Map<string, number>()
  private readonly output: vscode.OutputChannel
  private capabilities: Capabilities = {
    platform: process.platform,
    notifySend: false,
    notifySendActions: false,
    terminalNotifier: false,
  }
  private pollHandle?: NodeJS.Timeout

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel("OpenCode Notify")
    this.context.subscriptions.push(this.output)

    const stored = this.context.workspaceState.get<Record<string, unknown>>(
      OFFSETS_STATE_KEY,
      {},
    )
    for (const [uri, offset] of Object.entries(stored)) {
      if (typeof offset === "number" && Number.isFinite(offset) && offset >= 0) {
        this.offsets.set(uri, offset)
      }
    }
  }

  async activate(): Promise<void> {
    this.capabilities = await this.detectCapabilities()
    this.log(
      `ready platform=${this.capabilities.platform} notifySend=${this.capabilities.notifySend} notifySendActions=${this.capabilities.notifySendActions} terminalNotifier=${this.capabilities.terminalNotifier}`,
    )

    this.context.subscriptions.push(vscode.window.registerUriHandler(this))

    this.context.subscriptions.push(
      vscode.commands.registerCommand("opencodeNotify.scanNow", async () => {
        await this.scanAll("manual")
      }),
    )

    this.context.subscriptions.push(
      vscode.commands.registerCommand("opencodeNotify.showDiagnostics", () => {
        this.showDiagnostics()
      }),
    )

    const watcher = vscode.workspace.createFileSystemWatcher(`**/${QUEUE_RELATIVE_PATH}`)
    this.context.subscriptions.push(watcher)
    watcher.onDidCreate(
      (uri: vscode.Uri) => {
        void this.scanOne(uri, "create")
      },
      null,
      this.context.subscriptions,
    )
    watcher.onDidChange(
      (uri: vscode.Uri) => {
        void this.scanOne(uri, "change")
      },
      null,
      this.context.subscriptions,
    )

    this.startPolling()
    this.context.subscriptions.push(
      new vscode.Disposable(() => {
        if (this.pollHandle) {
          clearInterval(this.pollHandle)
          this.pollHandle = undefined
        }
      }),
    )

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("opencodeNotify.pollIntervalMs")) {
          this.startPolling()
        }
      }),
    )

    await this.scanAll("startup")
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== "/opencode-jump") return

    const params = new URLSearchParams(uri.query)
    const worktree = params.get("worktree") || undefined
    if (worktree && !this.matchesWorkspace(worktree)) return

    const ppid = Number(params.get("ppid"))
    if (Number.isInteger(ppid) && ppid > 0) {
      for (const terminal of vscode.window.terminals) {
        try {
          const pid = await terminal.processId
          if (pid === ppid) {
            terminal.show(false)
            this.log(`terminal jump matched by ppid=${ppid}`)
            return
          }
        } catch {
          // Some terminals may not expose processId.
        }
      }
    }

    const origin = (params.get("origin") || "").toLowerCase()
    if (origin.length) {
      const found = vscode.window.terminals.find((terminal) => {
        const name = terminal.name.toLowerCase()
        return name.includes("opencode") && name.includes(origin)
      })
      if (found) {
        found.show(false)
        this.log(`terminal jump matched by origin=${origin}`)
      }
    }
  }

  private startPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle)
      this.pollHandle = undefined
    }

    const interval = this.pollIntervalMs()
    this.pollHandle = setInterval(() => {
      void this.scanAll("poll")
    }, interval)
    this.pollHandle.unref?.()

  }

  private pollIntervalMs(): number {
    const configured = vscode.workspace
      .getConfiguration()
      .get<number>("opencodeNotify.pollIntervalMs", 2000)
    if (typeof configured !== "number" || !Number.isFinite(configured)) return 2000
    return Math.max(500, Math.min(60000, Math.floor(configured)))
  }

  private async detectCapabilities(): Promise<Capabilities> {
    const caps: Capabilities = {
      platform: process.platform,
      notifySend: false,
      notifySendActions: false,
      terminalNotifier: false,
    }

    if (process.platform === "linux") {
      const version = await runCommand("notify-send", ["--version"])
      caps.notifySend = version.ok
      if (caps.notifySend) {
        const probe = await runCommand("notify-send", ["--help"])
        const text = `${probe.stdout}\n${probe.stderr}`
        caps.notifySendActions = text.includes("--action")
      }
    }

    if (process.platform === "darwin") {
      const probe = await runCommand("terminal-notifier", ["-help"])
      caps.terminalNotifier = probe.ok
    }

    return caps
  }

  private matchesWorkspace(worktree: string): boolean {
    const target = normalizePath(worktree)
    const folders = vscode.workspace.workspaceFolders ?? []
    return folders.some((folder) => {
      const uriPath = normalizePath(folder.uri.path)
      const fsPath = normalizePath(folder.uri.fsPath || "")
      return uriPath === target || fsPath === target
    })
  }

  async scanAll(reason: string): Promise<void> {
    if (!this.isEnabled()) return

    const folders = vscode.workspace.workspaceFolders ?? []
    for (const folder of folders) {
      const queueUri = vscode.Uri.joinPath(folder.uri, QUEUE_RELATIVE_PATH)
      await this.scanOne(queueUri, reason)
    }
  }

  private async scanOne(queueUri: vscode.Uri, reason: string): Promise<void> {
    try {
      const content = await vscode.workspace.fs.readFile(queueUri)
      const previousOffset = this.offsets.get(queueUri.toString()) ?? 0
      const safeOffset = previousOffset <= content.length ? previousOffset : 0

      let cursor = safeOffset
      while (cursor < content.length) {
        const newline = content.indexOf(10, cursor)
        if (newline < 0) break

        const line = Buffer.from(content.subarray(cursor, newline)).toString("utf8").trim()
        cursor = newline + 1
        if (!line.length) continue

        const entry = parseQueueEntry(line)
        if (!entry) continue
        void this.notify(entry)
      }

      if (cursor !== previousOffset) {
        if (cursor === content.length && content.length > MAX_QUEUE_BYTES) {
          await vscode.workspace.fs.writeFile(queueUri, Buffer.from("", "utf8"))
          cursor = 0
        }

        this.offsets.set(queueUri.toString(), cursor)
        await this.persistOffsets()
        await this.writeStatus(queueUri, cursor)
      }
    } catch (error) {
      if (!this.isFileNotFound(error)) {
        this.log(`scan failed (${reason}) ${queueUri.toString()}: ${String(error)}`)
      }
    }
  }

  private async writeStatus(queueUri: vscode.Uri, offset: number): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(queueUri)
    if (!folder) return

    const statusUri = vscode.Uri.joinPath(folder.uri, STATUS_RELATIVE_PATH)
    const payload = {
      updatedAt: new Date().toISOString(),
      extensionVersion: this.context.extension.packageJSON.version,
      queueUri: queueUri.toString(),
      offset,
      platform: process.platform,
      capabilities: this.capabilities,
    }

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".opencode"))
      await vscode.workspace.fs.writeFile(
        statusUri,
        Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
      )
    } catch {
      // Status file is best-effort diagnostics only.
    }
  }

  private async notify(entry: QueueEntry): Promise<void> {
    const title = entry.count && entry.count > 1 ? `${entry.title} x${entry.count}` : entry.title
    const sound = mapSoundToken(entry.event, entry.sound)
    const jumpUri = sanitizeJumpUri(entry.jumpUri, this.context.extension.id)

    if (process.platform === "win32") {
      await this.notifyWindows(title, entry.body, jumpUri, sound)
      return
    }

    if (process.platform === "darwin") {
      await this.notifyMac(title, entry.body, jumpUri, sound)
      return
    }

    if (process.platform === "linux") {
      await this.notifyLinux(title, entry.body, jumpUri, sound)
      return
    }

    void vscode.window.showInformationMessage(`${title}: ${entry.body}`)
  }

  private async notifyWindows(
    title: string,
    body: string,
    jumpUri: string | undefined,
    sound: boolean | string,
  ): Promise<void> {
    const audio = this.windowsAudioNode(sound)
    const action = jumpUri
      ? `<actions><action content="Open in VS Code" activationType="protocol" arguments="${escapeXml(jumpUri)}"/></actions>`
      : ""

    const xml = `<toast><visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>${audio}${action}</toast>`
    const encoded = Buffer.from(xml, "utf8").toString("base64")
    const script = [
      "$bytes = [Convert]::FromBase64String('" + encoded + "')",
      "$xmlString = [Text.Encoding]::UTF8.GetString($bytes)",
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null",
      "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "$xml.LoadXml($xmlString)",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode Notify').Show($toast)",
    ].join("; ")

    await runCommand("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ])
  }

  private windowsAudioNode(sound: boolean | string): string {
    if (sound === false) return '<audio silent="true"/>'

    if (typeof sound === "string") {
      if (sound.startsWith("ms-winsoundevent:")) {
        return `<audio src="${escapeXml(sound)}"/>`
      }
      if (sound === "attention") {
        return '<audio src="ms-winsoundevent:Notification.Reminder"/>'
      }
      if (sound === "error") {
        return '<audio src="ms-winsoundevent:Notification.SMS"/>'
      }
    }

    return ""
  }

  private async notifyMac(
    title: string,
    body: string,
    jumpUri: string | undefined,
    sound: boolean | string,
  ): Promise<void> {
    if (this.capabilities.terminalNotifier) {
      const args = ["-title", title, "-message", body, "-group", "opencode-notify"]
      if (jumpUri) args.push("-open", jumpUri)
      if (sound !== false) {
        const mapped =
          typeof sound === "string"
            ? sound === "attention"
              ? "Glass"
              : sound === "error"
                ? "Basso"
                : sound
            : "default"
        args.push("-sound", mapped)
      }
      await runCommand("terminal-notifier", args)
      return
    }

    await runCommand("osascript", [
      "-e",
      `display notification ${appleQuote(body.replace(/\r?\n/g, " - "))} with title ${appleQuote(title)}`,
    ])
  }

  private async notifyLinux(
    title: string,
    body: string,
    jumpUri: string | undefined,
    sound: boolean | string,
  ): Promise<void> {
    if (!this.capabilities.notifySend) return

    const urgency =
      sound === "attention" ? "critical" : sound === "error" ? "normal" : "low"
    const soundName = toLinuxSoundName(sound)

    const baseArgs = ["--urgency", urgency, "--expire-time", "10000"]
    if (soundName && sound !== false) {
      baseArgs.push("--hint", `string:sound-name:${soundName}`)
    }

    if (jumpUri && this.capabilities.notifySendActions) {
      const actionResult = await runCommand(
        "notify-send",
        [
          "--action=open=Open in VS Code",
          "--wait",
          ...baseArgs,
          title,
          body,
        ],
        { timeoutMs: 120000 },
      )

      if (actionResult.ok) {
        if (actionResult.stdout.trim().startsWith("open")) {
          void this.openUri(jumpUri)
        }
        return
      }
    }

    await runCommand("notify-send", [...baseArgs, title, body])
  }

  private async openUri(uriText: string): Promise<void> {
    try {
      await vscode.env.openExternal(vscode.Uri.parse(uriText))
    } catch {
      // Non-fatal.
    }
  }

  private async persistOffsets(): Promise<void> {
    const serializable: Record<string, number> = {}
    for (const [key, value] of this.offsets.entries()) {
      serializable[key] = value
    }
    await this.context.workspaceState.update(OFFSETS_STATE_KEY, serializable)
  }

  private showDiagnostics(): void {
    this.output.clear()
    this.output.appendLine("OpenCode Notify diagnostics")
    this.output.appendLine(`- platform: ${process.platform}`)
    this.output.appendLine(`- enabled: ${this.isEnabled()}`)
    this.output.appendLine(`- pollIntervalMs: ${this.pollIntervalMs()}`)
    this.output.appendLine(
      `- capabilities: ${JSON.stringify(this.capabilities)}`,
    )
    this.output.appendLine(`- workspaceFolders: ${(vscode.workspace.workspaceFolders || []).length}`)
    this.output.appendLine("- offsets:")
    for (const [key, value] of this.offsets.entries()) {
      this.output.appendLine(`  - ${key}: ${value}`)
    }
    this.output.show(true)
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration()
      .get<boolean>("opencodeNotify.enabled", true)
  }

  private isFileNotFound(error: unknown): boolean {
    if (!isObject(error)) return false
    const code = error.code
    if (typeof code !== "string") return false
    return code === "FileNotFound"
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`)
  }
}

let runtime: NotifyExtension | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  runtime = new NotifyExtension(context)
  await runtime.activate()
}

export function deactivate(): void {
  runtime = undefined
}
