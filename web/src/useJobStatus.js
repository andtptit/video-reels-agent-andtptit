import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

/** Subscribes to a project's SSE progress stream and keeps a live `{ steps, events }`
 *  snapshot in state. Falls back to whatever GET /projects/:id already had (the
 *  "snapshot" event the server sends as the first SSE message) so a page reload
 *  doesn't lose in-progress status. */
export function useJobStatus(projectId) {
  const [status, setStatus] = useState({ steps: {}, events: [], totalUsage: null });
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;
    const source = new EventSource(api.eventsUrl(projectId));
    sourceRef.current = source;

    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.type === "snapshot") {
        setStatus(event.status);
        return;
      }
      setStatus((prev) => {
        const steps = { ...prev.steps };
        let totalUsage = prev.totalUsage;
        if (event.step && ["running", "done", "error"].includes(event.status)) {
          steps[event.step] = {
            step: event.step,
            status: event.status,
            at: event.at,
            ...(event.error ? { error: event.error } : {}),
            ...(event.usage ? { usage: event.usage } : {}),
          };
          // Mirrors job-status.mjs's server-side accumulation so the running total
          // stays correct without waiting for a full page reload / new SSE snapshot.
          if (event.usage) {
            totalUsage = {
              promptTokens: (totalUsage?.promptTokens ?? 0) + (event.usage.promptTokens ?? 0),
              completionTokens: (totalUsage?.completionTokens ?? 0) + (event.usage.completionTokens ?? 0),
              totalTokens: (totalUsage?.totalTokens ?? 0) + (event.usage.totalTokens ?? 0),
              apiCalls: (totalUsage?.apiCalls ?? 0) + (event.usage.apiCalls ?? 0),
            };
          }
        }
        return { ...prev, steps, totalUsage, events: [...(prev.events ?? []), event].slice(-500) };
      });
    };

    return () => source.close();
  }, [projectId]);

  return status;
}
