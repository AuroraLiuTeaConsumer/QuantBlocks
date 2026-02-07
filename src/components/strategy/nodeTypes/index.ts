import type { NodeTypes } from "@xyflow/react";
import { PriceNode } from "./PriceNode";
import { VolumeNode } from "./VolumeNode";
import { RsiNode } from "./RsiNode";
import { ConstantNode } from "./ConstantNode";
import { CompareNode } from "./CompareNode";
import { CrossNode } from "./CrossNode";
import { AndNode } from "./AndNode";
import { OrNode } from "./OrNode";
import { NotNode } from "./NotNode";
import { OpenPositionNode } from "./OpenPositionNode";
import { ClosePositionNode } from "./ClosePositionNode";
import { SetRiskNode } from "./SetRiskNode";

export const strategyNodeTypes: NodeTypes = {
  price: PriceNode,
  volume: VolumeNode,
  rsi: RsiNode,
  constant: ConstantNode,
  compare: CompareNode,
  cross: CrossNode,
  and: AndNode,
  or: OrNode,
  not: NotNode,
  open_position: OpenPositionNode,
  close_position: ClosePositionNode,
  set_risk: SetRiskNode,
};

export { PriceNode, VolumeNode, RsiNode, ConstantNode, CompareNode, CrossNode, AndNode, OrNode, NotNode, OpenPositionNode, ClosePositionNode, SetRiskNode };
