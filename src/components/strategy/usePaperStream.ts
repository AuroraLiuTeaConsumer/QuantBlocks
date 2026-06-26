"use client";

/**
 * usePaperStream — subscribe to live paper-session snapshots via SSE.
 *
 * Gated by NEXT_PUBLIC_PAPER_STREAM="true". When the flag is absent or the
 * sessionId is null, the hook is a no-op and returns { streaming: false }.
 *
 * The poll loop in PaperTradingPanel remains active as a fallback:
 *   - If SSE is disabled → poll owns the data.
 *   - If SSE errors → streaming drops to false → poll takes over.
 *   - If SSE is healthy → poll fires redundantly but is harmless.
 */

import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "@/lib/paper/engine";

const SSE_ENABLED = process.env.NEXT_PUBLIC_PAPER_STREAM === "true";

/**
 * @param sessionId  The paper-trading session to stream. Pass null to skip.
 * @param onSnapshot Called with each fresh snapshot delivered by SSE.
 * @returns          { streaming } — true while the EventSource is connected.
 */
export function usePaperStream(
  sessionId: string | null,
  onSnapshot: (snap: SessionSnapshot) => void,
): { streaming: boolean } {
  const [streaming, setStreaming] = useState(false);

  // Keep onSnapshot in a ref so the effect never re-runs due to callback
  // identity changes (e.g. inline arrow functions in the parent).
  const cbRef = useRef(onSnapshot);
  useEffect(() => {
    cbRef.current = onSnapshot;
  });

  useEffect(() => {
    // Gate: feature flag off or no session selected → do nothing.
    if (!SSE_ENABLED || !sessionId) return;

    const es = new EventSource(`/api/paper/${sessionId}/stream`);

    es.onopen = () => {
      setStreaming(true);
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as { type?: string } & SessionSnapshot;
        // Skip heartbeat frames — they carry no snapshot data.
        if (data.type === "heartbeat") return;
        cbRef.current(data);
      } catch {
        // Malformed frame — ignore.
      }
    };

    es.onerror = () => {
      // On error the browser will attempt to reconnect automatically.
      // Set streaming=false so the poll loop takes over in the interim.
      setStreaming(false);
    };

    return () => {
      es.close();
      setStreaming(false);
    };
  }, [sessionId]);

  if (!SSE_ENABLED || !sessionId) {
    return { streaming: false };
  }

  return { streaming };
}
