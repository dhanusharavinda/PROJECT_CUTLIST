"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDetail, MessageWithAuthor } from "@/lib/queries";

export interface Presence {
  id: string;
  name: string;
}

/**
 * One SSE connection per open project, shared by every panel on the page.
 *
 * Chat messages are applied directly because they arrive constantly and their
 * payload is complete. Everything else (a note transcribed, a label ticked, the
 * brief edited) triggers a debounced refetch of the whole project — the payload
 * is small, and it keeps merge logic out of the client entirely.
 */
export type Connection = "connecting" | "live" | "down";

export function useProject(initial: ProjectDetail) {
  const [project, setProject] = useState<ProjectDetail>(initial);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");

  const projectId = initial.project.id;
  const downTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        cache: "no-store",
      });
      if (res.ok) setProject((await res.json()) as ProjectDetail);
    } catch {
      /* the SSE reconnect will bring us back in sync */
    } finally {
      inflight.current = false;
    }
  }, [projectId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, 220);
  }, [refresh]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/stream`);

    const clearDownTimer = () => {
      if (downTimer.current) clearTimeout(downTimer.current);
      downTimer.current = null;
    };

    const goLive = () => {
      clearDownTimer();
      setConnection("live");
    };

    /**
     * EventSource retries on its own, and a route compiling in dev or a brief
     * blip both fire `onerror`. Warning the user instantly would mean a red
     * flash on nearly every page load, so a drop only becomes visible once it
     * has actually persisted.
     */
    const goDown = () => {
      if (downTimer.current) return;
      downTimer.current = setTimeout(() => setConnection("down"), 2500);
    };

    source.addEventListener("ready", goLive);
    source.addEventListener("presence", (event) => {
      try {
        setPresence(JSON.parse((event as MessageEvent).data) as Presence[]);
      } catch {
        /* ignore malformed frame */
      }
    });

    source.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        if (payload?.refresh) return scheduleRefresh();
        setProject((current) =>
          current.messages.some((m) => m.id === payload.id)
            ? current
            : {
                ...current,
                messages: [...current.messages, payload as MessageWithAuthor],
              },
        );
      } catch {
        scheduleRefresh();
      }
    });

    for (const type of ["note", "label", "video", "brief", "suggestion"]) {
      source.addEventListener(type, scheduleRefresh);
    }

    source.onerror = goDown;
    source.onopen = goLive;

    return () => {
      source.close();
      clearDownTimer();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [projectId, scheduleRefresh]);

  return {
    project,
    setProject,
    presence,
    connection,
    live: connection === "live",
    refresh,
  };
}

/** Small helper so every call site handles API errors the same way. */
export async function api<T>(
  input: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};

  let res: Response;
  try {
    res = await fetch(input, {
      ...rest,
      headers:
        json !== undefined
          ? { "Content-Type": "application/json", ...(rest.headers ?? {}) }
          : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    // fetch only rejects on a transport failure, and "Failed to fetch" is not
    // something to put in front of a person.
    throw new Error(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? "You appear to be offline. Reconnect and try again."
        : "Can’t reach the Cutlist server. Check that it is still running, then try again.",
    );
  }

  if (res.status === 401) {
    throw new Error("Your session expired. Reload the page to sign in again.");
  }
  if (res.status === 413) {
    throw new Error("That file is larger than this instance allows.");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}
