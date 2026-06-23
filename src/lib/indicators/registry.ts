import type { IndicatorDefinition, IIndicatorRegistry } from "./types";
import { SmaDefinition } from "./builtins/sma";
import { EmaDefinition } from "./builtins/ema";
import { RsiDefinition } from "./builtins/rsi";
import { MacdDefinition } from "./builtins/macd";
import { BollingerDefinition } from "./builtins/bollinger";
import { AtrDefinition } from "./builtins/atr";
import { VwapDefinition } from "./builtins/vwap";
import { StochasticDefinition } from "./builtins/stochastic";
import { ObvDefinition } from "./builtins/obv";
import { AdxDefinition } from "./builtins/adx";
import { DonchianDefinition } from "./builtins/donchian";
import { KeltnerDefinition } from "./builtins/keltner";

class IndicatorRegistryImpl implements IIndicatorRegistry {
  private readonly defs = new Map<string, IndicatorDefinition>();

  register(def: IndicatorDefinition): void {
    this.defs.set(def.id, def);
  }

  get(id: string): IndicatorDefinition | undefined {
    return this.defs.get(id);
  }

  getAll(): IndicatorDefinition[] {
    return [...this.defs.values()];
  }

  getByCategory(category: IndicatorDefinition["category"]): IndicatorDefinition[] {
    return this.getAll().filter((d) => d.category === category);
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }
}

export const indicatorRegistry = new IndicatorRegistryImpl();

// Phase A
indicatorRegistry.register(SmaDefinition);
indicatorRegistry.register(EmaDefinition);
indicatorRegistry.register(RsiDefinition);
indicatorRegistry.register(MacdDefinition);
indicatorRegistry.register(BollingerDefinition);
indicatorRegistry.register(AtrDefinition);
// Phase B
indicatorRegistry.register(VwapDefinition);
indicatorRegistry.register(StochasticDefinition);
indicatorRegistry.register(ObvDefinition);
indicatorRegistry.register(AdxDefinition);
indicatorRegistry.register(DonchianDefinition);
indicatorRegistry.register(KeltnerDefinition);
