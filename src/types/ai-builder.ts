// ---------------------------------------------------------------------------
// Conversation lifecycle
// ---------------------------------------------------------------------------

// Phase A prompt emits: "collecting_requirements" | "ready_to_generate"
// "idle" is the client initial state. "graph_generated", "revising", "error" are reserved for future phases.
export type ConversationStatus =
  | "idle"
  | "collecting_requirements"
  | "ready_to_generate"
  | "graph_generated"
  | "revising"
  | "error";

export type AIBuilderIntent =
  | "create_strategy"
  | "modify_strategy"
  | "add_condition"
  | "add_risk_management"
  | "explain_strategy"
  | "unknown";

// Phase A prompt emits: "ask_clarification" | "ready_to_generate"
// "update_draft" and "confirm_graph" are reserved for future phases.
export type AIBuilderNextAction =
  | "ask_clarification"
  | "update_draft"
  | "ready_to_generate"
  | "confirm_graph";

// ---------------------------------------------------------------------------
// Strategy draft — progressively filled during the interview
// ---------------------------------------------------------------------------

export type StrategyDraftConditionType =
  | "indicator_threshold"
  | "crossover"
  | "price_level"
  | "volume_spike"
  | "custom";

export type StrategyDraftCondition = {
  type: StrategyDraftConditionType;
  description: string;
  indicator?: string;
  params?: Record<string, number | string>;
  comparator?: ">" | "<" | ">=" | "<=" | "==";
  threshold?: number;
  thresholdType?: "fixed" | "indicator_multiple";
  thresholdIndicator?: string;
};

export type StrategyDraftStopLoss = {
  type: "pct" | "candle_low" | "atr";
  value?: number;
};

export type StrategyDraftTakeProfit = {
  type: "pct" | "rr_ratio" | "atr";
  value?: number;
};

export type StrategyDraftRiskRule = {
  stopLoss?: StrategyDraftStopLoss;
  takeProfit?: StrategyDraftTakeProfit;
  positionSizePct?: number;
};

export type StrategyDraftFilter = {
  type: "trend" | "volatility" | "volume" | "time" | "custom";
  description: string;
};

export type MissingRequirement = {
  field: string;
  priority: "required" | "recommended";
  question: string;
};

export type StrategyDraft = {
  symbol?: string;
  timeframe?: string;
  direction?: "long" | "short" | "both";
  entryConditions: StrategyDraftCondition[];
  confirmationConditions: StrategyDraftCondition[];
  exitConditions: StrategyDraftCondition[];
  riskRules?: StrategyDraftRiskRule;
  filters: StrategyDraftFilter[];
  missingFields: MissingRequirement[];
  assumptions: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Chat message
// ---------------------------------------------------------------------------

export type AIBuilderMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  quickReplies?: string[];
};

// ---------------------------------------------------------------------------
// Full conversation state (client-side, not persisted in Phase A)
// ---------------------------------------------------------------------------

export type AIBuilderConversation = {
  id: string;
  status: ConversationStatus;
  intent: AIBuilderIntent;
  messages: AIBuilderMessage[];
  draft: StrategyDraft;
};

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export type BuilderMessageRequest = {
  messages: AIBuilderMessage[];
  currentDraft: StrategyDraft;
  canvasContext?: unknown;
};

export type BuilderMessageResponse = {
  message: string;
  quickReplies?: string[];
  draftUpdate: Partial<StrategyDraft>;
  missingFields: MissingRequirement[];
  nextAction: AIBuilderNextAction;
  conversationStatus: ConversationStatus;
};
