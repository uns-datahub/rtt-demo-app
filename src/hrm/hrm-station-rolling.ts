import type { HrmBatch, RollingPhysicsState, RollingStandConfig } from "./hrm-types.js";
import { estimateRollForceKn, firstOrderLag, materialStrengthMpa, motorPowerKw, secondOrderResponse, sensorOscillation } from "./hrm-physics.js";

/**
 * Advance rolling stand physics by one tick.
 * @param effectiveTickMs  tickIntervalMs × simulationSpeed — how much process time one tick represents
 */
export function tickRolling(
  batch: HrmBatch,
  config: RollingStandConfig,
  effectiveTickMs: number
): { state: RollingPhysicsState; done: boolean } {
  const passes = batch.recipe.rollingPlan.passes;
  const step = batch.ticksInStage;

  // Derive ticks per pass from real-world pass duration scaled by effective tick size
  const ticksPerPass = Math.max(1, Math.ceil((config.durationMinPerPass * 60_000) / effectiveTickMs));

  const currentPassIndex = Math.floor(step / ticksPerPass);
  const tickInPass = step % ticksPerPass;

  // All passes complete
  if (currentPassIndex >= passes.length) {
    const lastPass = passes[passes.length - 1];
    const finalState: RollingPhysicsState = {
      currentPass: passes.length,
      totalPasses: passes.length,
      direction: lastPass?.direction ?? "forward",
      targetSpeedMps: lastPass?.speedMps ?? 0,
      actualSpeedMps: lastPass?.speedMps ?? 0,
      measuredSpeedMps: lastPass?.speedMps ?? 0,
      speedAccelerationMps2: 0,
      actualThicknessMm: lastPass?.targetThicknessMm ?? batch.recipe.targetThicknessMm,
      measuredThicknessMm: lastPass?.targetThicknessMm ?? batch.recipe.targetThicknessMm,
      targetThicknessMm: batch.recipe.targetThicknessMm,
      actualRollGapMm: lastPass?.targetThicknessMm ?? batch.recipe.targetThicknessMm,
      measuredRollGapMm: lastPass?.targetThicknessMm ?? batch.recipe.targetThicknessMm,
      actualRollForcekN: 0,
      measuredRollForcekN: 0,
      actualMotorPowerKw: 0,
      measuredMotorPowerKw: 0,
      actualMotorCurrentA: 0,
      measuredMotorCurrentA: 0,
      actualStandTorqueKnm: 0,
      measuredStandTorqueKnm: 0,
      actualHydraulicPressureBar: 0,
      measuredHydraulicPressureBar: 0,
      actualLubricationFlowLpm: 0,
      measuredLubricationFlowLpm: 0,
      actualBearingTempC: 0,
      measuredBearingTempC: 0,
      actualVibrationMmS: 0,
      measuredVibrationMmS: 0,
      subState: "DONE",
    };
    return { state: finalState, done: true };
  }

  const pass = passes[currentPassIndex]!;
  const prevPass = currentPassIndex > 0 ? passes[currentPassIndex - 1]! : null;
  const startThickness = prevPass?.targetThicknessMm ?? batch.recipe.initialThicknessMm;
  const prevState = batch.rolling;

  // Interpolate thickness reduction over ticks in this pass
  const reductionProgress = ticksPerPass > 1 ? Math.min(1, tickInPass / (ticksPerPass - 1)) : 1;
  const currentThicknessMm = Number(
    (startThickness - (startThickness - pass.targetThicknessMm) * reductionProgress).toFixed(2)
  );

  // Speed with small oscillation (motor noise)
  const speedOscillation = sensorOscillation(step, 0.05, 4, currentPassIndex * 0.8);
  const speedResponse = secondOrderResponse(
    prevState?.actualSpeedMps ?? (pass.speedMps * 0.65),
    prevState?.speedAccelerationMps2 ?? 0,
    pass.speedMps,
    effectiveTickMs,
  );
  const actualSpeedMps = Number(Math.max(0.1, speedResponse.value + speedOscillation).toFixed(3));

  // Force and power
  const strength = materialStrengthMpa(batch.recipe.materialType);
  const rollForcekN = estimateRollForceKn(startThickness, pass.targetThicknessMm, batch.recipe.targetWidthMm, strength);
  const powerKw = motorPowerKw(rollForcekN, actualSpeedMps);
  const motorCurrentA = Number((95 + ((Math.min(powerKw, config.maxMotorPowerKw) / config.maxMotorPowerKw) * 220) + sensorOscillation(step, 4, 6, 0.5)).toFixed(1));
  const standTorqueKnm = Number(((Math.min(powerKw, config.maxMotorPowerKw) / Math.max(actualSpeedMps, 0.15)) * 0.95).toFixed(1));
  const rollGapMm = Number((pass.targetThicknessMm + sensorOscillation(step, 0.25, 8, currentPassIndex * 0.4)).toFixed(2));
  const hydraulicPressureBar = Number((145 + ((rollForcekN / config.maxForceKn) * 55) + sensorOscillation(step, 2, 7, 0.8)).toFixed(1));
  const lubricationFlowLpm = Number((34 + ((actualSpeedMps / Math.max(config.nominalSpeedMps, 0.1)) * 7) + sensorOscillation(step, 1.2, 10, 1.1)).toFixed(1));
  const bearingTempC = Number((52 + ((Math.min(powerKw, config.maxMotorPowerKw) / config.maxMotorPowerKw) * 16) + sensorOscillation(step, 0.7, 11, 0.3)).toFixed(1));
  const vibrationMmS = Number((1.8 + ((rollForcekN / config.maxForceKn) * 1.6) + Math.abs(sensorOscillation(step, 0.25, 5, 1.7))).toFixed(2));
  const measuredSpeedMps = Number((actualSpeedMps + sensorOscillation(step, 0.02, 6, 0.2)).toFixed(3));
  const measuredThicknessMm = Number((currentThicknessMm + sensorOscillation(step, 0.04, 7, 0.6)).toFixed(2));
  const measuredRollForcekN = Number((rollForcekN + sensorOscillation(step, Math.max(6, rollForcekN * 0.004), 5, 0.4)).toFixed(1));
  const measuredMotorPowerKw = Number((Math.min(powerKw, config.maxMotorPowerKw) + sensorOscillation(step, 3, 8, 0.3)).toFixed(1));
  const measuredMotorCurrentA = Number((motorCurrentA + sensorOscillation(step, 1.6, 6, 0.5)).toFixed(1));
  const measuredRollGapMm = Number((rollGapMm + sensorOscillation(step, 0.03, 9, 0.8)).toFixed(2));
  const measuredStandTorqueKnm = Number((standTorqueKnm + sensorOscillation(step, 1.5, 8, 0.1)).toFixed(1));
  const measuredHydraulicPressureBar = Number((hydraulicPressureBar + sensorOscillation(step, 0.8, 7, 0.7)).toFixed(1));
  const measuredLubricationFlowLpm = Number((lubricationFlowLpm + sensorOscillation(step, 0.5, 10, 1.1)).toFixed(1));
  const measuredBearingTempC = Number((bearingTempC + sensorOscillation(step, 0.2, 11, 0.3)).toFixed(1));
  const measuredVibrationMmS = Number((vibrationMmS + Math.abs(sensorOscillation(step, 0.03, 5, 1.7))).toFixed(2));

  const state: RollingPhysicsState = {
    currentPass: currentPassIndex + 1,
    totalPasses: passes.length,
    direction: pass.direction,
    targetSpeedMps: pass.speedMps,
    actualSpeedMps,
    measuredSpeedMps,
    speedAccelerationMps2: Number(speedResponse.velocity.toFixed(3)),
    actualThicknessMm: currentThicknessMm,
    measuredThicknessMm,
    targetThicknessMm: pass.targetThicknessMm,
    actualRollGapMm: rollGapMm,
    measuredRollGapMm,
    actualRollForcekN: rollForcekN,
    measuredRollForcekN,
    actualMotorPowerKw: Math.min(powerKw, config.maxMotorPowerKw),
    measuredMotorPowerKw,
    actualMotorCurrentA: motorCurrentA,
    measuredMotorCurrentA,
    actualStandTorqueKnm: standTorqueKnm,
    measuredStandTorqueKnm,
    actualHydraulicPressureBar: hydraulicPressureBar,
    measuredHydraulicPressureBar,
    actualLubricationFlowLpm: lubricationFlowLpm,
    measuredLubricationFlowLpm,
    actualBearingTempC: bearingTempC,
    measuredBearingTempC,
    actualVibrationMmS: vibrationMmS,
    measuredVibrationMmS,
    subState: "ROLLING",
  };

  return { state, done: false };
}

export function tickIdleRolling(
  prevState: RollingPhysicsState | undefined,
  config: RollingStandConfig,
  effectiveTickMs: number,
  step: number,
): RollingPhysicsState {
  const speedResponse = secondOrderResponse(
    prevState?.actualSpeedMps ?? 0,
    prevState?.speedAccelerationMps2 ?? 0,
    0,
    effectiveTickMs,
  );
  const actualSpeedMps = Number(Math.max(0, speedResponse.value).toFixed(3));
  const lubricationFlowLpm = Number((8 + sensorOscillation(step, 0.8, 12, 0.5)).toFixed(1));
  const bearingTempC = Number(firstOrderLag(prevState?.actualBearingTempC ?? 34, 35 + sensorOscillation(step, 0.4, 18, 0.3), effectiveTickMs, 180).toFixed(1));
  const hydraulicPressureBar = Number(firstOrderLag(prevState?.actualHydraulicPressureBar ?? 58, 60 + sensorOscillation(step, 1.2, 16, 0.7), effectiveTickMs, 45).toFixed(1));
  const vibrationMmS = Number((0.28 + Math.abs(sensorOscillation(step, 0.05, 10, 1.2))).toFixed(2));
  const measuredSpeedMps = Number((actualSpeedMps + sensorOscillation(step, 0.01, 8, 0.2)).toFixed(3));
  const measuredMotorCurrentA = Number((18 + sensorOscillation(step, 1.1, 14, 0.9)).toFixed(1));
  const measuredRollGapMm = Number((28 + sensorOscillation(step, 0.02, 16, 0.4)).toFixed(2));
  const measuredHydraulicPressureBar = Number((hydraulicPressureBar + sensorOscillation(step, 0.5, 16, 0.7)).toFixed(1));
  const measuredLubricationFlowLpm = Number((lubricationFlowLpm + sensorOscillation(step, 0.2, 12, 0.5)).toFixed(1));
  const measuredBearingTempC = Number((bearingTempC + sensorOscillation(step, 0.1, 18, 0.3)).toFixed(1));
  const measuredVibrationMmS = Number((vibrationMmS + Math.abs(sensorOscillation(step, 0.02, 10, 1.2))).toFixed(2));

  return {
    currentPass: 0,
    totalPasses: 0,
    direction: "forward",
    targetSpeedMps: 0,
    actualSpeedMps,
    measuredSpeedMps,
    speedAccelerationMps2: Number(speedResponse.velocity.toFixed(3)),
    actualThicknessMm: 0,
    measuredThicknessMm: 0,
    targetThicknessMm: 0,
    actualRollGapMm: Number(firstOrderLag(prevState?.actualRollGapMm ?? 28, 28, effectiveTickMs, 120).toFixed(2)),
    measuredRollGapMm,
    actualRollForcekN: 0,
    measuredRollForcekN: 0,
    actualMotorPowerKw: 0,
    measuredMotorPowerKw: 0,
    actualMotorCurrentA: measuredMotorCurrentA,
    measuredMotorCurrentA,
    actualStandTorqueKnm: 0,
    measuredStandTorqueKnm: 0,
    actualHydraulicPressureBar: hydraulicPressureBar,
    measuredHydraulicPressureBar,
    actualLubricationFlowLpm: lubricationFlowLpm,
    measuredLubricationFlowLpm,
    actualBearingTempC: bearingTempC,
    measuredBearingTempC,
    actualVibrationMmS: vibrationMmS,
    measuredVibrationMmS,
    subState: "IDLE",
  };
}
