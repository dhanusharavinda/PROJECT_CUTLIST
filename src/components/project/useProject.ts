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
export function useProject(initial: ProjectDetail) {
  const [project, setProject] = useState<ProjectDetail>(initial);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [live, setLive] = useState(false);

  const projectId = initial.project.id;
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

    source.addEventListener("ready", () => setLive(true));
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

    source.onerror = () => setLive(false);
    source.onopen = () => setLive(true);

    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [projectId, scheduleRefresh]);

  return { project, setProject, presence, live, refresh };
}

/** Small helper so every call site handles API errors the same way. */
export async function api<T>(
  input: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(input, {
    ...rest,
    headers:
      json !== undefined
        ? { "Content-Type": "application/json", ...(rest.headers ?? {}) }
        : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

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
