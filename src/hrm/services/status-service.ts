import type { HrmProductionLine } from "../hrm-production-line.js";
import type { ProductionLineStateResponse } from "../hrm-types.js";

export function getProductionLineState(line: HrmProductionLine): ProductionLineStateResponse {
  return line.getState();
}
