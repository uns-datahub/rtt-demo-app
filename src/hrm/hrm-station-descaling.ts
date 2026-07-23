import type { HrmBatch, DescalingPhysicsState, DescalingConfig } from "./hrm-types.js";
import { firstOrderLag, sensorOscillation } from "./hrm-physics.js";

/**
 * Advance descaling physics by one tick.
 * @param effectiveTickMs  tickIntervalMs × simulationSpeed — how much process time one tick represents
 */
export function tickDescaling(
  batch: HrmBatch,
  config: DescalingConfig,
  effectiveTickMs: number
): { state: DescalingPhysicsState; done: boolean } {
  const step = batch.ticksInStage;
  const elapsedTicks = step + 1;
  const prevState = batch.descaling;

  // Derive total ticks from real-world duration scaled by the effective tick size
  const totalTicks = Math.max(1, Math.ceil((config.durationMin * 60_000) / effectiveTickMs));
  const progress = Math.min(1, elapsedTicks / totalTicks);

  const pressureTargetBar = config.nominalPressureBar + sensorOscillation(step, 5, 8, 0);
  const pressureBar = firstOrderLag(prevState?.actualPressureBar ?? (config.nominalPressureBar * 0.85), pressureTargetBar, effectiveTickMs, 3);

  const flowTargetM3h = config.nominalFlowM3PerHour + sensorOscillation(step, 0.5, 6, 1.2);
  const flowM3h = firstOrderLag(prevState?.actualFlowM3h ?? (config.nominalFlowM3PerHour * 0.9), flowTargetM3h, effectiveTickMs, 2);
  const headerPressureBar = pressureBar - 6 + sensorOscillation(step, 1.2, 5, 0.4);
  const pumpSpeedRpm = 1450 + (progress * 120) + sensorOscillation(step, 25, 7, 0.6);
  const pumpCurrentA = 210 + (progress * 18) + sensorOscillation(step, 6, 9, 0.9);
  const nozzleValveOpenPct = 78 + (progress * 15) + sensorOscillation(step, 2.5, 10, 1.1);
  const waterTempC = 27 + sensorOscillation(step, 1.2, 14, 0.2);
  const consumptionIncrementM3 = (flowM3h * effectiveTickMs) / 3_600_000;
  const totalWaterConsumptionM3 = (prevState?.totalWaterConsumptionM3 ?? 0) + consumptionIncrementM3;
  const hydraulicOilLevelPct = Math.max(52, 88 - (progress * 4) + sensorOscillation(step, 0.6, 20, 0.7));
  const hydraulicOilTempC = 41 + (progress * 6) + sensorOscillation(step, 0.8, 12, 1.4);
  const measuredPressureBar = Number((pressureBar + sensorOscillation(step, 1.1, 8, 0.2)).toFixed(1));
  const measuredFlowM3h = Number((flowM3h + sensorOscillation(step, 0.12, 6, 0.4)).toFixed(2));
  const measuredHeaderPressureBar = Number((headerPressureBar + sensorOscillation(step, 0.8, 5, 0.5)).toFixed(1));
  const measuredPumpSpeedRpm = Number((pumpSpeedRpm + sensorOscillation(step, 6, 9, 0.6)).toFixed(0));
  const measuredPumpCurrentA = Number((pumpCurrentA + sensorOscillation(step, 1.6, 10, 0.8)).toFixed(1));
  const measuredNozzleValveOpenPct = Number((nozzleValveOpenPct + sensorOscillation(step, 0.9, 11, 1.1)).toFixed(1));
  const measuredWaterTempC = Number((waterTempC + sensorOscillation(step, 0.2, 14, 0.2)).toFixed(1));
  const measuredHydraulicOilLevelPct = Number((hydraulicOilLevelPct + sensorOscillation(step, 0.2, 18, 0.7)).toFixed(1));
  const measuredHydraulicOilTempC = Number((hydraulicOilTempC + sensorOscillation(step, 0.3, 12, 1.4)).toFixed(1));

  const done = elapsedTicks >= totalTicks;

  const state: DescalingPhysicsState = {
    actualPressureBar: Number(pressureBar.toFixed(1)),
    measuredPressureBar,
    actualHeaderPressureBar: Number(headerPressureBar.toFixed(1)),
    measuredHeaderPressureBar,
    actualFlowM3h: Number(flowM3h.toFixed(2)),
    measuredFlowM3h,
    actualPumpSpeedRpm: Number(pumpSpeedRpm.toFixed(0)),
    measuredPumpSpeedRpm,
    actualPumpCurrentA: Number(pumpCurrentA.toFixed(1)),
    measuredPumpCurrentA,
    actualNozzleValveOpenPct: Number(nozzleValveOpenPct.toFixed(1)),
    measuredNozzleValveOpenPct,
    actualWaterTempC: Number(waterTempC.toFixed(1)),
    measuredWaterTempC,
    totalWaterConsumptionM3: Number(totalWaterConsumptionM3.toFixed(3)),
    actualHydraulicOilLevelPct: Number(hydraulicOilLevelPct.toFixed(1)),
    measuredHydraulicOilLevelPct,
    actualHydraulicOilTempC: Number(hydraulicOilTempC.toFixed(1)),
    measuredHydraulicOilTempC,
    subState: done ? "DONE" : "PROCESSING",
    elapsedTicks,
    totalTicks,
  };

  return { state, done };
}

export function tickIdleDescaling(
  prevState: DescalingPhysicsState | undefined,
  config: DescalingConfig,
  effectiveTickMs: number,
  step: number,
): DescalingPhysicsState {
  const pressureTargetBar = 18 + sensorOscillation(step, 1.5, 14, 0.2);
  const pressureBar = firstOrderLag(prevState?.actualPressureBar ?? 12, pressureTargetBar, effectiveTickMs, 8);
  const flowTargetM3h = Math.max(0.2, (config.nominalFlowM3PerHour * 0.04) + sensorOscillation(step, 0.15, 10, 0.8));
  const flowM3h = firstOrderLag(prevState?.actualFlowM3h ?? (config.nominalFlowM3PerHour * 0.03), flowTargetM3h, effectiveTickMs, 6);
  const headerPressureBar = Math.max(0, pressureBar - 12);
  const pumpSpeedRpm = 320 + sensorOscillation(step, 20, 9, 0.4);
  const pumpCurrentA = 28 + sensorOscillation(step, 2.5, 11, 1.1);
  const nozzleValveOpenPct = Math.max(0, 2 + sensorOscillation(step, 0.6, 18, 0.9));
  const waterTempC = Number(firstOrderLag(prevState?.actualWaterTempC ?? 24, 24 + sensorOscillation(step, 0.4, 20, 0.1), effectiveTickMs, 30).toFixed(1));
  const totalWaterConsumptionM3 = Number(((prevState?.totalWaterConsumptionM3 ?? 0) + ((flowM3h * effectiveTickMs) / 3_600_000)).toFixed(3));
  const hydraulicOilLevelPct = Number(firstOrderLag(prevState?.actualHydraulicOilLevelPct ?? 86, 86, effectiveTickMs, 1200).toFixed(1));
  const hydraulicOilTempC = Number(firstOrderLag(prevState?.actualHydraulicOilTempC ?? 36, 36 + sensorOscillation(step, 0.3, 22, 0.6), effectiveTickMs, 120).toFixed(1));
  const measuredPressureBar = Number((pressureBar + sensorOscillation(step, 0.5, 14, 0.2)).toFixed(1));
  const measuredFlowM3h = Number((flowM3h + sensorOscillation(step, 0.04, 10, 0.8)).toFixed(2));
  const measuredHeaderPressureBar = Number((headerPressureBar + sensorOscillation(step, 0.3, 12, 0.5)).toFixed(1));
  const measuredPumpSpeedRpm = Number((pumpSpeedRpm + sensorOscillation(step, 3, 12, 0.4)).toFixed(0));
  const measuredPumpCurrentA = Number((pumpCurrentA + sensorOscillation(step, 0.8, 13, 1.1)).toFixed(1));
  const measuredNozzleValveOpenPct = Number((nozzleValveOpenPct + sensorOscillation(step, 0.2, 18, 0.9)).toFixed(1));
  const measuredWaterTempC = Number((waterTempC + sensorOscillation(step, 0.1, 20, 0.1)).toFixed(1));
  const measuredHydraulicOilLevelPct = Number((hydraulicOilLevelPct + sensorOscillation(step, 0.08, 25, 0.7)).toFixed(1));
  const measuredHydraulicOilTempC = Number((hydraulicOilTempC + sensorOscillation(step, 0.15, 22, 0.6)).toFixed(1));

  return {
    actualPressureBar: Number(pressureBar.toFixed(1)),
    measuredPressureBar,
    actualHeaderPressureBar: Number(headerPressureBar.toFixed(1)),
    measuredHeaderPressureBar,
    actualFlowM3h: Number(flowM3h.toFixed(2)),
    measuredFlowM3h,
    actualPumpSpeedRpm: Number(pumpSpeedRpm.toFixed(0)),
    measuredPumpSpeedRpm,
    actualPumpCurrentA: Number(pumpCurrentA.toFixed(1)),
    measuredPumpCurrentA,
    actualNozzleValveOpenPct: Number(nozzleValveOpenPct.toFixed(1)),
    measuredNozzleValveOpenPct,
    actualWaterTempC: waterTempC,
    measuredWaterTempC,
    totalWaterConsumptionM3,
    actualHydraulicOilLevelPct: hydraulicOilLevelPct,
    measuredHydraulicOilLevelPct,
    actualHydraulicOilTempC: hydraulicOilTempC,
    measuredHydraulicOilTempC,
    subState: "IDLE",
    elapsedTicks: 0,
    totalTicks: 0,
  };
}
