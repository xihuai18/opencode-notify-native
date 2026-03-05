import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import type { NotifyEventType, NotifySound } from "./types.js";

import { loadPluginConfig } from "./config.js";
import { createEventClassifier } from "./classify.js";
import { NotifyDispatcher } from "./dispatcher.js";
import { debugEnabled, debugWarn } from "./debug.js";
import {
  firstLine,
  formatCollapsedBody,
  sanitizeText,
  shortPath,
  toProjectName,
} from "./text.js";
import { createNativeNotifier } from "./native.js";

type NativeNotify = (input: {
  title: string;
  body: string;
  event: NotifyEventType;
  sound: NotifySound;
  group?: string;
}) => Promise<boolean>;

function labelForEvent(event: NotifyEventType): string {
  if (event === "complete") return "Completed";
  if (event === "error") return "Error";
  return "Attention";
}

function eventEnabled(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
): boolean {
  if (!config.enabled) return false;
  if (event === "complete") return config.events.complete;
  if (event === "error") return config.events.error;
  return config.events.attention;
}

function eventSound(
  event: NotifyEventType,
  config: Awaited<ReturnType<typeof loadPluginConfig>>,
) {
  if (event === "complete") return config.soundByEvent.complete;
  if (event === "error") return config.soundByEvent.error;
  return config.soundByEvent.attention;
}

function extractEventPayload(payload: unknown): unknown | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { event?: unknown; type?: unknown };
  // Prefer wrapped `{ event: {...} }` payloads from transport envelopes.
  if (value.event && typeof value.event === "object") {
    const nested = value.event as { type?: unknown };
    if (typeof nested.type === "string") return value.event;
  }
  if (typeof value.type === "string") return payload;
  if ("event" in value) return value.event;
  return null;
}

function makeBody(input: {
  sessionID?: string;
  event: NotifyEventType;
  summary: string;
  directory: string;
  showDirectory: boolean;
  showSessionId: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`${labelForEvent(input.event)} · ${input.summary}`.trim());

  if (input.showDirectory) {
    lines.push(`Project Dir: ${input.directory}`);
  }
  if (input.showSessionId && input.sessionID) {
    lines.push(`Session ID: ${input.sessionID.slice(0, 8)}`);
  }

  return lines.join("\n");
}

function formatSessionTitle(input: {
  sessionTitle?: string;
  fallback: string;
  sanitize: boolean;
}): string {
  const first = input.sessionTitle ? firstLine(input.sessionTitle) : "";
  if (!first) return input.fallback;

  const sanitized = sanitizeText(first, {
    enabled: input.sanitize,
    maxLength: 72,
  });
  return sanitized || input.fallback;
}

export function createOpenCodeNotifyPlugin(
  deps: {
    notifyNative?: NativeNotify;
  } = {},
) {
  return async function OpenCodeNotifyPlugin(
    input: PluginInput,
  ): Promise<Hooks> {
    const notifyNative = deps.notifyNative || createNativeNotifier();
    const config = await loadPluginConfig(input.worktree, input.directory);
    const project = sanitizeText(
      toProjectName(input.worktree, input.directory),
      {
        enabled: config.sanitize,
        maxLength: 60,
      },
    );
    const classifyEvent = createEventClassifier();
    const unknownEventTypesSeen = new Set<string>();

    const dispatcher = new NotifyDispatcher({
      collapseWindowMs: config.collapseWindowMs,
      cooldownMs: config.cooldownMs,
      send: async (payload, count) => {
        const title = sanitizeText(payload.title, {
          enabled: config.sanitize,
          // Title limits vary by platform; keep it short and predictable.
          maxLength: 120,
        });
        const body = formatCollapsedBody(payload.body, count, {
          enabled: config.sanitize,
          maxLength: config.maxBodyLength,
        });
        return notifyNative({
          title,
          body,
          event: payload.event,
          sound: payload.sound,
          group: payload.replaceKey,
        }).catch(() => {
          debugWarn(
            `notifyNative threw: event=${payload.event} key=${payload.collapseKey}`,
          );
          return false;
        });
      },
    });

    const notify = (inputEvent: {
      event: NotifyEventType;
      source: string;
      summary: string;
      sessionID?: string;
      sessionTitle?: string;
      collapseKey: string;
      topicKey?: string;
    }) => {
      if (!eventEnabled(inputEvent.event, config)) return;

      const summary = firstLine(inputEvent.summary);
      const sessionTitle = formatSessionTitle({
        sessionTitle: inputEvent.sessionTitle,
        fallback: project,
        sanitize: config.sanitize,
      });

      const baseReplaceKey = `opencode:${project}:${inputEvent.event}:${inputEvent.sessionID || "global"}`;
      // Align OS-level replacement with dispatcher-level attention dedupe so
      // distinct prompts don't overwrite each other in notification centers.
      const replaceKey =
        inputEvent.event === "attention" && inputEvent.topicKey
          ? `${baseReplaceKey}:${inputEvent.topicKey}`
          : baseReplaceKey;

      const body = makeBody({
        sessionID: inputEvent.sessionID,
        event: inputEvent.event,
        summary,
        directory: shortPath(input.worktree),
        showDirectory: config.showDirectory,
        showSessionId: config.showSessionId,
      });

      dispatcher.enqueue({
        event: inputEvent.event,
        title: `OpenCode · ${sessionTitle}`,
        body,
        sound: eventSound(inputEvent.event, config),
        collapseKey: inputEvent.collapseKey,
        replaceKey,
      });
    };

    const hooks = {
      event: (payload) => {
        const done = Promise.resolve();
        try {
          const eventPayload = extractEventPayload(payload);
          if (!eventPayload) {
            debugWarn("event hook received malformed payload");
            return done;
          }

          const classified = classifyEvent(eventPayload);
          if (!classified) {
            if (
              debugEnabled() &&
              eventPayload &&
              typeof eventPayload === "object" &&
              "type" in eventPayload &&
              typeof (eventPayload as { type: unknown }).type === "string"
            ) {
              const eventType = String((eventPayload as { type: string }).type);
              if (
                !unknownEventTypesSeen.has(eventType) &&
                unknownEventTypesSeen.size < 64
              ) {
                unknownEventTypesSeen.add(eventType);
                debugWarn(`ignored non-notification event type: ${eventType}`);
              }
            }
            return done;
          }
          notify(classified);
        } catch (error) {
          debugWarn(
            `event hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Notification side effects should never block OpenCode flows.
        }
        return done;
      },
    } satisfies Hooks;
    return hooks;
  };
}

export default createOpenCodeNotifyPlugin();
