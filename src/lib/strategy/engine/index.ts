/**
 * Strategy Execution Engine — shared by Backtest and Paper Trading.
 *
 * Usage:
 *   const result = compileGraph(graph);
 *   if (!result.ok) { handle errors }
 *   const exec = result.value;
 *   let state = createInitialState(10_000);
 *   for (const bar of bars) {
 *     const { state: next, actions, events } = step(exec, bar, state);
 *     state = next;
 *     // events contain OPENED/CLOSED trade events
 *   }
 */

export { compileGraph } from "./compile";
export { createInitialState, step, forceClose } from "./runtime";
export type {
  Bar,
  ExecutableGraph,
  CompileResult,
  CompileError,
  EngineState,
  Action,
  TradeEvent,
  StepResult,
  PositionState,
  RsiState,
} from "./types";
