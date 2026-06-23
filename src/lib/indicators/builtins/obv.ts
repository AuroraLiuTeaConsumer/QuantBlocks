import type { IndicatorDefinition } from "../types";

interface ObvState extends Record<string, unknown> {
  obv: number;
  prevClose: number | null;
}

export const ObvDefinition: IndicatorDefinition = {
  id: "obv",
  name: "OBV",
  category: "volume",
  description: "On Balance Volume — running total that adds volume on up bars and subtracts on down bars.",
  inputs: ["close"],
  parameters: [],
  outputs: [{ name: "value", label: "OBV", type: "number" }],
  warmupBars: () => 1,
  createState: () => ({ obv: 0, prevClose: null } satisfies ObvState),
  step({ bar, state }) {
    const s = state as unknown as ObvState;

    if (s.prevClose === null) {
      return {
        outputs: { value: 0 },
        nextState: { obv: 0, prevClose: bar.close },
      };
    }

    const vol = bar.volume ?? 0;
    let obv = s.obv;
    if (bar.close > s.prevClose)      obv += vol;
    else if (bar.close < s.prevClose) obv -= vol;
    // equal close → OBV unchanged

    return { outputs: { value: obv }, nextState: { obv, prevClose: bar.close } };
  },
};
