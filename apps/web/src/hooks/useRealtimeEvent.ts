import { useEffect, useRef } from "react";

export type RealtimeEventPayload = {
  type: string;
  classId?: string;
  studentId?: string;
  studentIds?: string[];
  subjectId?: string;
  actorId?: string;
  timestamp?: number;
};

export function useRealtimeEvent(
  events: string[],
  onEvent: (payload: RealtimeEventPayload) => void,
  enabled: boolean = true
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
    const sseUrl = `${apiBase}/realtime/events`;

    let eventSource: EventSource | null = null;
    let isComponentMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!isComponentMounted) return;

      try {
        eventSource = new EventSource(sseUrl, { withCredentials: true });

        events.forEach((eventType) => {
          eventSource?.addEventListener(eventType, (e: MessageEvent) => {
            try {
              const data = JSON.parse(e.data);
              onEventRef.current(data);
            } catch {
              // Ignore parse errors
            }
          });
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          // Retry connection after 5s
          if (isComponentMounted) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        };
      } catch {
        // Retry connection after 5s if failed to construct
        if (isComponentMounted) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      isComponentMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [events.join(","), enabled]);
}
