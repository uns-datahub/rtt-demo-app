import type { HrmBatch, WarehousePhysicsState } from "./hrm-types.js";
import type { QualitySpec } from "./hrm-types.js";
import { estimateHardnessHB, estimateSurfaceGrade } from "./hrm-physics.js";

/**
 * Perform quality check — runs once when batch enters warehouse.
 * Compares actual measurements against quality spec (NOT recipe).
 */
export function runQualityCheck(
  batch: HrmBatch,
  qualitySpec: QualitySpec,
  step: number
): WarehousePhysicsState {
  const targetThickness = batch.recipe.targetThicknessMm;
  const measuredThicknessMm = batch.measured.finalThicknessMm ?? batch.rolling?.measuredThicknessMm ?? targetThickness;
  const measuredExitTempC =
    batch.measured.rollingExitTempC
    ?? batch.measured.descalingExitTempC
    ?? batch.measured.furnaceExitTempC
    ?? batch.recipe.furnace.targetTempC;

  // Metrology remains slightly noisy, but it now measures actual simulated end-state.
  const thicknessNoise = (Math.sin(step * 1.7) * 0.04) + (Math.cos(step * 2.3) * 0.03);
  const finalThicknessMm = Number((measuredThicknessMm + thicknessNoise).toFixed(2));
  const finalTempC = Number((measuredExitTempC + sensorNoise(step, 5)).toFixed(1));

  const hardnessHB = estimateHardnessHB(
    finalTempC,
    qualitySpec.idealExitTempC,
    qualitySpec.minHardnessHB,
    qualitySpec.maxHardnessHB
  );

  const surfaceGrade = estimateSurfaceGrade(finalTempC, qualitySpec.idealExitTempC, step);

  const thicknessDeviationMm = Number(Math.abs(finalThicknessMm - qualitySpec.idealThicknessMm).toFixed(3));
  const tempDeviationC = Number(Math.abs(finalTempC - qualitySpec.idealExitTempC).toFixed(1));

  const failReasons: string[] = [];
  if (thicknessDeviationMm > qualitySpec.thicknessToleranceMm) {
    failReasons.push(`odstopanje debeline ${thicknessDeviationMm} mm presega toleranco ${qualitySpec.thicknessToleranceMm} mm`);
  }
  if (tempDeviationC > qualitySpec.exitTempToleranceC) {
    failReasons.push(`odstopanje izstopne temperature ${tempDeviationC} C presega toleranco ${qualitySpec.exitTempToleranceC} C`);
  }
  if (hardnessHB < qualitySpec.minHardnessHB || hardnessHB > qualitySpec.maxHardnessHB) {
    failReasons.push(`trdota ${hardnessHB} HB je izven območja ${qualitySpec.minHardnessHB}-${qualitySpec.maxHardnessHB} HB`);
  }
  if (surfaceGrade > qualitySpec.surfaceGrade) {
    failReasons.push(`površinski razred ${surfaceGrade} je slabši od zahtevanega ${qualitySpec.surfaceGrade}`);
  }
  const passFail = failReasons.length === 0;

  return {
    specId: qualitySpec.id,
    finalThicknessMm,
    finalTempC,
    hardnessHB,
    surfaceGrade,
    passFail,
    thicknessDeviationMm,
    tempDeviationC,
    failReasons,
  };
}

function sensorNoise(step: number, amplitude: number): number {
  return Math.sin(step * 1.3 + 0.5) * amplitude;
}
