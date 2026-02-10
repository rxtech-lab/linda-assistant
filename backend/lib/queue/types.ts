export const AGENT_TASKS_QUEUE = "agent-tasks";
export const AGENT_EVENTS_EXCHANGE = "agent-events";

export interface AgentTask {
  sessionId: string;
  userId: string;
  type: "message" | "confirmation_resolved";
  timestamp: number;
}

export interface AgentEvent {
  sessionId: string;
  event: string;
  data: unknown;
  timestamp: number;
}
