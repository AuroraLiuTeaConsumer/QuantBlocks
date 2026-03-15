# AI Strategy

## How AI Strategy Draft Generation Works

- **Entry**: AiPromptPanel → POST `/api/ai/translateStrategy` with `{ prompt }`
- **Current**: Stub route returns a fixed RSI strategy regardless of prompt
- **Output**: `{ strategyName, timeframe, nodes, edges, notes }`

## Graph JSON Generation

- Stub uses `EXAMPLE_STRATEGY_NODES` and `EXAMPLE_STRATEGY_EDGES` from `lib/data/candles.ts`
- Nodes: RSI(14), constant(30), constant(70), compare(RSI<30), compare(RSI>70), open_position long 0.01, close_position
- Edges connect: RSI→buy compare, 30→buy compare; RSI→sell compare, 70→sell compare; buy→open, sell→close

## Zod Validation

- AiPromptPanel calls `StrategyGraphSchema.safeParse({ nodes, edges })`
- Schema from `lib/strategy/graphTypes.ts` (StrategyNodeSchema, StrategyEdgeSchema)
- On failure: display validation errors in panel, call `onError`

## Apply / Save / Rollback Behavior

1. **Apply**: User clicks "Apply Strategy" → `setAppliedGraph(draftGraph)`, `setDraftGraph(null)`, `setSaveRequestKey(k+1)`
2. **Save**: StrategyCanvas receives new `initialNodes/initialEdges`; `saveRequestKey` change triggers one-time save via `persistGraph` with initial graph
3. **Success**: `onSaveSuccess` clears applied graph, resets pending apply
4. **Failure**: `onSaveError`; if `prevGraphRef` exists, rollback `setAppliedGraph(prevGraphRef.current)`

## Cancel Draft

- User clicks "Cancel" → `setDraftGraph(null)`; draft discarded, no save

## Known Constraints and Future Extension Points

- **Stub**: No LLM; prompt ignored. To add real LLM: call external API, parse response, validate with Zod.
- **Single output**: Only one graph returned; no variants or suggestions.
- **No strategy name from prompt**: Stub sets "RSI Mean-Reversion (AI Generated)"; could derive from prompt.
- **Zod**: Validates structure; cannot ensure strategy is profitable or well-formed logically.
- **Apply flow**: Depends on sync between Workspace and Canvas; `saveRequestKey` forces save of applied graph.
