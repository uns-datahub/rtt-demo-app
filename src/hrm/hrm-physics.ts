/**
 * Pure physics simulation functions — no side effects, no state.
 * All functions are deterministic given the same inputs.
 */

/**
 * PLC-style temperature control: setpoint + lag oscillation.
 * Models a zone that overshoots/undershoots slightly as the PLC hunts.
 */
export function plcZoneTemperature(
  step: number,
  setpointC: number,
  zoneId: number,
  oscAmplitudeC = 4
): number {
  const phaseOffset = zoneId * 1.3;
  const slowHunt = Math.sin(step / 20 + phaseOffset) * oscAmplitudeC;
  const fastRipple = Math.sin(step / 5 + phaseOffset * 2) * (oscAmplitudeC * 0.25);
  return Number((setpointC + slowHunt + fastRipple).toFixed(1));
}

export function firstOrderLag(
  currentValue: number,
  targetValue: number,
  tickMs: number,
  timeConstantSec: number
): number {
  const alpha = 1 - Math.exp(-(tickMs / 1000) / Math.max(timeConstantSec, 0.001));
  return currentValue + ((targetValue - currentValue) * alpha);
}

export function secondOrderResponse(
  currentValue: number,
  currentVelocity: number,
  targetValue: number,
  tickMs: number,
  naturalFrequencyHz = 0.35,
  dampingRatio = 0.82
): { value: number; velocity: number } {
  const omega = 2 * Math.PI * naturalFrequencyHz;
  const maxSubstepMs = 100;
  const steps = Math.max(1, Math.ceil(tickMs / maxSubstepMs));
  const dt = (tickMs / steps) / 1000;

  let value = currentValue;
  let velocity = currentVelocity;

  for (let i = 0; i < steps; i += 1) {
    const acceleration =
      (omega * omega * (targetValue - value)) -
      (2 * dampingRatio * omega * velocity);
    velocity += acceleration * dt;
    value += velocity * dt;
  }

  return { value, velocity };
}

/**
 * Slab heating response in the furnace.
 * Thicker slabs heat more slowly; width has a smaller secondary influence.
 */
export function slabHeatResponse(
  currentTempC: number,
  sourceTempC: number,
  tickMs: number,
  thicknessMm: number,
  widthMm: number,
): number {
  const thicknessFactor = Math.pow(Math.max(thicknessMm, 10) / 200, 1.7);
  const widthFactor = 0.9 + (0.1 * (Math.max(widthMm, 100) / 1500));
  const tauSec = 140 * thicknessFactor * widthFactor;
  return Number(firstOrderLag(currentTempC, sourceTempC, tickMs, tauSec).toFixed(1));
}

/**
 * Estimate roll force in kN for a single pass.
 * Simplified: force is proportional to reduction, width, and material strength.
 */
export function estimateRollForceKn(
  currentThicknessMm: number,
  targetThicknessMm: number,
  widthMm: number,
  materialStrengthMpa: number
): number {
  const reductionMm = Math.max(0, currentThicknessMm - targetThicknessMm);
  const contactLength = Math.sqrt(reductionMm * 350); // roll radius ~350mm
  const meanPressureMpa = materialStrengthMpa * 1.15; // Bland-Ford factor approx
  const forceN = meanPressureMpa * 1e6 * (widthMm / 1000) * (contactLength / 1000);
  return Number((forceN / 1000).toFixed(1)); // → kN
}

/**
 * Motor power from roll force and rolling speed.
 */
export function motorPowerKw(
  rollForcekN: number,
  speedMps: number,
  efficiency = 0.92
): number {
  return Number(((rollForcekN * 1000 * speedMps) / (1000 * efficiency)).toFixed(1));
}

/**
 * Small oscillation — models sensor noise, motor speed ripple, pressure fluctuation.
 */
export function sensorOscillation(
  step: number,
  amplitude: number,
  period: number,
  phaseOffset = 0
): number {
  return Math.sin((step / period) * Math.PI * 2 + phaseOffset) * amplitude;
}

/**
 * Hardness model: colder exit = harder steel (inverse relationship).
 * Baseline at ideal exit temp; deviates ±HB per degree.
 */
export function estimateHardnessHB(
  actualExitTempC: number,
  idealExitTempC: number,
  minHB: number,
  maxHB: number
): number {
  const midHB = (minHB + maxHB) / 2;
  const rangeHB = (maxHB - minHB) / 2;
  // 30°C deviation maps to ±range/2
  const tempFactor = (idealExitTempC - actualExitTempC) / 30;
  const hardness = midHB + tempFactor * (rangeHB * 0.6);
  return Number(Math.max(minHB - 5, Math.min(maxHB + 5, hardness)).toFixed(0));
}

/**
 * Surface grade based on temperature deviation and noise.
 * Small noise introduces occasional B grades, larger deviations produce C.
 */
export function estimateSurfaceGrade(
  actualExitTempC: number,
  idealExitTempC: number,
  step: number
): string {
  const deviation = Math.abs(actualExitTempC - idealExitTempC);
  const noise = Math.abs(Math.sin(step * 0.7)) * 15;
  if (deviation + noise > 50) return "C";
  if (deviation + noise > 25) return "B";
  return "A";
}

/**
 * Material strength approximation by type (yield strength in MPa).
 */
export function materialStrengthMpa(materialType: string): number {
  const strengths: Record<string, number> = {
    "S235": 235,
    "S275": 275,
    "S355": 355,
    "S420": 420,
    "S460": 460,
  };
  return strengths[materialType] ?? 300;
}
