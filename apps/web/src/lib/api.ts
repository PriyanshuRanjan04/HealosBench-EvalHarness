/**
 * lib/api.ts — Type-safe API client for the Hono server.
 * All calls go through here; the web app never calls Anthropic directly.
 */

import type { RunSummary, RunDetail, PromptStrategy } from "@test-evals/shared";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  /** List all runs, newest first */
  getRuns(): Promise<RunSummary[]> {
    return request<RunSummary[]>("/api/v1/runs");
  },

  /** Alias kept for compatibility */
  listRuns(): Promise<RunSummary[]> {
    return request<RunSummary[]>("/api/v1/runs");
  },

  /** Get a single run with all case results */
  getRun(id: string): Promise<RunDetail> {
    return request<RunDetail>(`/api/v1/runs/${id}`);
  },

  /** Start a new run (returns 202 with runId) */
  createRun(body: {
    strategy: PromptStrategy;
    model: string;
    dataset_filter?: string[];
    force?: boolean;
  }): Promise<{ runId: string }> {
    return request<{ runId: string }>("/api/v1/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Alias kept for compatibility */
  startRun(body: {
    strategy: PromptStrategy;
    model: string;
    dataset_filter?: string[];
    force?: boolean;
  }): Promise<{ runId: string }> {
    return api.createRun(body);
  },

  /** Compare two runs — returns per-field deltas */
  compareRuns(
    a: string,
    b: string,
  ): Promise<{
    runA: RunSummary;
    runB: RunSummary;
    fieldDeltas: Record<
      string,
      { a: number; b: number; delta: number; winner: "a" | "b" | "tie" }
    >;
  }> {
    return request(`/api/v1/runs/compare?a=${a}&b=${b}`);
  },

  /** Resume an interrupted run */
  resumeRun(id: string): Promise<{ runId: string }> {
    return request<{ runId: string }>(`/api/v1/runs/${id}/resume`, {
      method: "POST",
    });
  },

  /** Open an SSE EventSource (low-level) */
  streamRun(id: string): EventSource {
    return new EventSource(`${SERVER_URL}/api/v1/runs/${id}/stream`, {
      withCredentials: true,
    });
  },
};

/**
 * Callback-based SSE helper.
 *
 * The Hono server sends named events:
 *   event: progress   data: { caseResult, completed, total }
 *   event: done       data: { status }
 *
 * Returns a cleanup function that closes the EventSource.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function streamRunEvents(
  runId: string,
  onEvent: (data: { caseResult: any; completed: number; total: number }) => void,
  onDone: () => void,
): () => void {
  const es = new EventSource(`${SERVER_URL}/api/v1/runs/${runId}/stream`, {
    withCredentials: true,
  });

  es.addEventListener("progress", (e: MessageEvent) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      onEvent(JSON.parse(e.data));
    } catch {
      // ignore malformed data
    }
  });

  es.addEventListener("done", () => {
    onDone();
    es.close();
  });

  es.onerror = () => {
    es.close();
  };

  return () => es.close();
}
