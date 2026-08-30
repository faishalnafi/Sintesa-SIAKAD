import { EventEmitter } from "node:events";

export type RealtimeEventType =
  // Grade events
  | "grade_submitted"
  | "grade_approved"
  | "grade_rejected"
  | "grade_deleted"
  | "grade_data_restored"
  // Journal events
  | "journal_saved"
  | "journal_deleted"
  // Master data events
  | "student_updated"
  | "class_updated"
  | "subject_updated"
  | "teacher_assigned"
  // Integration events
  | "sync_completed"
  // System
  | "ping";

export type RealtimeEventPayload = {
  type: RealtimeEventType;
  classId?: string;
  studentId?: string;
  studentIds?: string[];
  subjectId?: string;
  actorId?: string;
  source?: string;      // e.g. "gds" | "kehadiran" | "sso"
  timestamp?: number;
};

const realtimeEmitter = new EventEmitter();
realtimeEmitter.setMaxListeners(200);

export function broadcastRealtimeEvent(payload: RealtimeEventPayload) {
  const eventWithTime = { ...payload, timestamp: Date.now() };
  realtimeEmitter.emit("realtime-event", eventWithTime);
}

export function subscribeRealtimeEvents(listener: (payload: RealtimeEventPayload) => void) {
  realtimeEmitter.on("realtime-event", listener);
  return () => {
    realtimeEmitter.off("realtime-event", listener);
  };
}
