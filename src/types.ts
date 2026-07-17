export type FlagValue = boolean | string;

export interface Subject {
  key: string;
  attributes?: Record<string, string | number | boolean>;
}

export type Clause = {
  attribute: string;
  operator: "equals" | "in";
  values: Array<string | number | boolean>;
};

export interface Segment {
  key: string;
  clauses: Clause[];
}

export interface Rule<T extends FlagValue> {
  id: string;
  clauses?: Clause[];
  segment?: string;
  value: T;
}

export interface Rollout<T extends FlagValue> {
  salt: string;
  variations: Array<{ value: T; weight: number }>;
}

export interface Flag<T extends FlagValue> {
  key: string;
  default: T;
  rules?: Rule<T>[];
  rollout?: Rollout<T>;
}

export interface FlagConfig {
  flags: Flag<FlagValue>[];
  segments?: Segment[];
}

export type EvaluationReason =
  | { kind: "RULE_MATCH"; ruleId: string }
  | { kind: "ROLLOUT"; bucket: number }
  | { kind: "DEFAULT" };

export interface Evaluation<T extends FlagValue = FlagValue> {
  flagKey: string;
  value: T;
  reason: EvaluationReason;
}

export interface AuditEvent {
  timestamp: string;
  subjectKey: string;
  evaluation: Evaluation;
}
