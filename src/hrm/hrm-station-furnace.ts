import type { HrmBatch, FurnacePhysicsState, FurnaceConfig } from "./hrm-types.js";
import { firstOrderLag, plcZoneTemperature, sensorOscillation, slabHeatResponse } from "./hrm-physics.js";

const AMBIENT_TEMP_C = 20;
const PUSHER_TOTAL_SLOTS = 5;
const SOAKING_START_BAND_C = 15;

function getSlotHeatSourceTemp(zones: FurnacePhysicsState["zones"], slotIndex: number): number {
  const z1 = zones[0]?.actualTempC ?? AMBIENT_TEMP_C;
  const z2 = zones[1]?.actualTempC ?? z1;
  const z3 = zones[2]?.actualTempC ?? z2;
  const z4 = zones[3]?.actualTempC ?? z3;

  switch (slotIndex) {
    case 1:
      return z1;
    case 2:
      return (z1 * 0.35) + (z2 * 0.65);
    case 3:
      return (z2 * 0.45) + (z3 * 0.55);
    case 4:
      return (z3 * 0.4) + (z4 * 0.6);
    case 5:
    default:
      return z4;
  }
}

function heatMaterialInSlot(
  currentTempC: number,
  slotHeatSourceTempC: number,
  effectiveTickMs: number,
  slotIndex: number,
  thicknessMm: number,
  widthMm: number,
): number {
  const approachTargetC = Math.max(AMBIENT_TEMP_C, slotHeatSourceTempC - 8);
  const zoneExposureFactor = slotIndex <= 1 ? 0.82 : slotIndex === 2 ? 0.9 : 1;
  return slabHeatResponse(currentTempC, approachTargetC * zoneExposureFactor, effectiveTickMs, thicknessMm, widthMm);
}

/**
 * Advance furnace physics by one tick.
 * Returns updated state and whether this stage is complete.
 */
export function tickFurnace(
  batch: HrmBatch,
  config: FurnaceConfig,
  effectiveTickMs: number,
): { state: FurnacePhysicsState; done: boolean } {
  const recipe = batch.recipe.furnace;
  const step = batch.ticksInStage;

  const prevState = batch.furnace;
  const prevMaterialTemp = prevState?.actualMaterialTempC ?? 20;
  const prevSubState = prevState?.subState ?? "HEATING";
  const prevSoakingElapsed = prevState?.soakingElapsedMin ?? 0;
  const prevPushCount = prevState?.pusherPushCount ?? 0;

  // Update zone temperatures with a first-order thermal response and PLC hunt around setpoints.
  const zones = recipe.zones.map((zone) => {
    const prevZone = prevState?.zones.find((item) => item.zoneId === zone.zoneId);
    const commandedTempC = plcZoneTemperature(step, zone.setpointC, zone.zoneId);
    const actualTempC = Number(firstOrderLag(prevZone?.actualTempC ?? zone.setpointC - 30, commandedTempC, effectiveTickMs, 45).toFixed(1));
    const measuredTempC = Number((actualTempC + sensorOscillation(step, 0.7, 9, zone.zoneId * 0.4)).toFixed(1));
    const heaterOn = actualTempC < zone.setpointC + 2;
    const gasConsumptionNm3h = heaterOn
      ? config.gasConsumptionNm3PerHour / recipe.zones.length
      : (config.gasConsumptionNm3PerHour / recipe.zones.length) * 0.1;
    const burnerLoadPct = Number(Math.max(8, Math.min(100, ((actualTempC / Math.max(zone.setpointC, 1)) * 100) + 6)).toFixed(1));
    const stoichiometricRatio = Number((recipe.stoichiometricRatioTarget + sensorOscillation(step, 0.015, 16, zone.zoneId * 0.6)).toFixed(3));
    const actualExhaustO2Pct = Number((2.2 + ((stoichiometricRatio - 1) * 14)).toFixed(2));
    const measuredExhaustO2Pct = Number((actualExhaustO2Pct + sensorOscillation(step, 0.18, 11, zone.zoneId)).toFixed(2));
    return { zoneId: zone.zoneId, setpointC: zone.setpointC, actualTempC, measuredTempC, heaterOn, gasConsumptionNm3h, burnerLoadPct, actualExhaustO2Pct, measuredExhaustO2Pct };
  });

  const avgZoneTempC = zones.reduce((sum, zone) => sum + zone.actualTempC, 0) / Math.max(1, zones.length);
  const actualChamberTempC = Number(Math.max(AMBIENT_TEMP_C, avgZoneTempC - 10).toFixed(1));
  const measuredChamberTempC = Number((actualChamberTempC + sensorOscillation(step, 0.6, 15, 0.5)).toFixed(1));

  // Advance material temperature.
  let actualMaterialTempC = prevMaterialTemp;
  let subState = prevSubState;
  let soakingElapsedMin = prevSoakingElapsed;
  let done = false;
  const elapsedMin = ((step + 1) * effectiveTickMs) / 60_000;
  const safePusherPaceMin = Math.max(recipe.pusherPaceMin, 0.001);
  const pusherPushCount = Math.min(PUSHER_TOTAL_SLOTS, Math.floor(elapsedMin / safePusherPaceMin));
  const pusherSlotIndex = Math.min(PUSHER_TOTAL_SLOTS, pusherPushCount + 1);
  const slotHeatSourceTempC = getSlotHeatSourceTemp(zones, pusherSlotIndex);
  const minutesIntoCurrentPace = elapsedMin - (pusherPushCount * safePusherPaceMin);
  const nextPushProgressPct = pusherPushCount >= PUSHER_TOTAL_SLOTS
    ? 100
    : Number(Math.max(0, Math.min(100, (minutesIntoCurrentPace / safePusherPaceMin) * 100)).toFixed(1));
  const minutesToNextPush = pusherPushCount >= PUSHER_TOTAL_SLOTS
    ? 0
    : Number(Math.max(0, safePusherPaceMin - minutesIntoCurrentPace).toFixed(2));

  actualMaterialTempC = heatMaterialInSlot(
    prevMaterialTemp,
    slotHeatSourceTempC,
    effectiveTickMs,
    pusherSlotIndex,
    batch.recipe.initialThicknessMm,
    batch.recipe.targetWidthMm,
  );

  if (actualMaterialTempC >= recipe.targetTempC - SOAKING_START_BAND_C) {
    subState = "SOAKING";
    soakingElapsedMin += effectiveTickMs / 60_000;
  } else {
    subState = "HEATING";
  }

  if (pusherPushCount >= PUSHER_TOTAL_SLOTS) {
    subState = "DONE";
    done = true;
  }
  const pusherPositionPct = Number((pusherPushCount > prevPushCount ? 100 : 0).toFixed(0));
  const measuredMaterialTempC = Number((actualMaterialTempC + sensorOscillation(step, 1.4, 13, 0.1)).toFixed(1));
  const actualFurnacePressurePa = Number((-18 + sensorOscillation(step, 3.6, 18, 0.1)).toFixed(1));
  const measuredFurnacePressurePa = Number((actualFurnacePressurePa + sensorOscillation(step, 0.9, 7, 0.8)).toFixed(1));

  const state: FurnacePhysicsState = {
    zones,
    slotMaterialIds: prevState?.slotMaterialIds ?? Array.from({ length: PUSHER_TOTAL_SLOTS }, () => ""),
    actualMaterialTempC,
    measuredMaterialTempC,
    actualChamberTempC,
    measuredChamberTempC,
    actualFurnacePressurePa,
    measuredFurnacePressurePa,
    pusherPositionPct,
    pusherPushCount,
    pusherSlotIndex,
    pusherTotalSlots: PUSHER_TOTAL_SLOTS,
    pusherPaceMin: Number(safePusherPaceMin.toFixed(2)),
    nextPushProgressPct,
    minutesToNextPush,
    totalFuelFlowNm3h: Number(zones.reduce((sum, zone) => sum + zone.gasConsumptionNm3h, 0).toFixed(2)),
    totalAirFlowNm3h: Number(zones.reduce((sum, zone, index) => {
      const ratio = recipe.stoichiometricRatioTarget + sensorOscillation(step, 0.015, 16, (index + 1) * 0.6);
      return sum + (zone.gasConsumptionNm3h * 9.8 * ratio);
    }, 0).toFixed(2)),
    subState,
    soakingElapsedMin: Number(soakingElapsedMin.toFixed(2)),
    soakingTargetMin: recipe.soakingTimeMin,
  };

  return { state, done };
}

export function buildActiveFurnaceZones(
  prevState: FurnacePhysicsState | undefined,
  recipe: HrmBatch["recipe"]["furnace"],
  config: FurnaceConfig,
  effectiveTickMs: number,
  step: number,
): FurnacePhysicsState["zones"] {
  return recipe.zones.map((zone) => {
    const prevZone = prevState?.zones.find((item) => item.zoneId === zone.zoneId);
    const commandedTempC = plcZoneTemperature(step, zone.setpointC, zone.zoneId);
    const actualTempC = Number(firstOrderLag(prevZone?.actualTempC ?? zone.setpointC - 30, commandedTempC, effectiveTickMs, 45).toFixed(1));
    const measuredTempC = Number((actualTempC + sensorOscillation(step, 0.7, 9, zone.zoneId * 0.4)).toFixed(1));
    const heaterOn = actualTempC < zone.setpointC + 2;
    const gasConsumptionNm3h = heaterOn
      ? config.gasConsumptionNm3PerHour / recipe.zones.length
      : (config.gasConsumptionNm3PerHour / recipe.zones.length) * 0.1;
    const burnerLoadPct = Number(Math.max(8, Math.min(100, ((actualTempC / Math.max(zone.setpointC, 1)) * 100) + 6)).toFixed(1));
    const stoichiometricRatio = Number((recipe.stoichiometricRatioTarget + sensorOscillation(step, 0.015, 16, zone.zoneId * 0.6)).toFixed(3));
    const actualExhaustO2Pct = Number((2.2 + ((stoichiometricRatio - 1) * 14)).toFixed(2));
    const measuredExhaustO2Pct = Number((actualExhaustO2Pct + sensorOscillation(step, 0.18, 11, zone.zoneId)).toFixed(2));
    return { zoneId: zone.zoneId, setpointC: zone.setpointC, actualTempC, measuredTempC, heaterOn, gasConsumptionNm3h, burnerLoadPct, actualExhaustO2Pct, measuredExhaustO2Pct };
  });
}

export function tickFurnaceBatchPhysics(
  batch: HrmBatch,
  prevState: FurnacePhysicsState | undefined,
  zones: FurnacePhysicsState["zones"],
  effectiveTickMs: number,
  slotIndex: number,
  pusherPaceMin: number,
  pusherPushCount: number,
  nextPushProgressPct: number,
  minutesToNextPush: number,
  pusherPositionPct: number,
): FurnacePhysicsState {
  const recipe = batch.recipe.furnace;
  const step = batch.ticksInStage;
  const prevMaterialTemp = prevState?.actualMaterialTempC ?? AMBIENT_TEMP_C;
  let subState = prevState?.subState ?? "HEATING";
  let soakingElapsedMin = prevState?.soakingElapsedMin ?? 0;
  const avgZoneTempC = zones.reduce((sum, zone) => sum + zone.actualTempC, 0) / Math.max(1, zones.length);
  const actualChamberTempC = Number(Math.max(AMBIENT_TEMP_C, avgZoneTempC - 10).toFixed(1));
  const measuredChamberTempC = Number((actualChamberTempC + sensorOscillation(step, 0.6, 15, 0.5)).toFixed(1));
  const slotHeatSourceTempC = getSlotHeatSourceTemp(zones, slotIndex);
  const actualMaterialTempC = heatMaterialInSlot(
    prevMaterialTemp,
    slotHeatSourceTempC,
    effectiveTickMs,
    slotIndex,
    batch.recipe.initialThicknessMm,
    batch.recipe.targetWidthMm,
  );

  if (actualMaterialTempC >= recipe.targetTempC - SOAKING_START_BAND_C) {
    subState = "SOAKING";
    soakingElapsedMin += effectiveTickMs / 60_000;
  } else {
    subState = "HEATING";
  }

  const measuredMaterialTempC = Number((actualMaterialTempC + sensorOscillation(step, 1.4, 13, 0.1)).toFixed(1));
  const actualFurnacePressurePa = Number((-18 + sensorOscillation(step, 3.6, 18, 0.1)).toFixed(1));
  const measuredFurnacePressurePa = Number((actualFurnacePressurePa + sensorOscillation(step, 0.9, 7, 0.8)).toFixed(1));

  return {
    zones,
    slotMaterialIds: prevState?.slotMaterialIds ?? Array.from({ length: PUSHER_TOTAL_SLOTS }, () => ""),
    actualMaterialTempC,
    measuredMaterialTempC,
    actualChamberTempC,
    measuredChamberTempC,
    actualFurnacePressurePa,
    measuredFurnacePressurePa,
    pusherPositionPct,
    pusherPushCount,
    pusherSlotIndex: slotIndex,
    pusherTotalSlots: PUSHER_TOTAL_SLOTS,
    pusherPaceMin: Number(pusherPaceMin.toFixed(2)),
    nextPushProgressPct,
    minutesToNextPush,
    totalFuelFlowNm3h: Number(zones.reduce((sum, zone) => sum + zone.gasConsumptionNm3h, 0).toFixed(2)),
    totalAirFlowNm3h: Number(zones.reduce((sum, zone, index) => {
      const ratio = recipe.stoichiometricRatioTarget + sensorOscillation(step, 0.015, 16, (index + 1) * 0.6);
      return sum + (zone.gasConsumptionNm3h * 9.8 * ratio);
    }, 0).toFixed(2)),
    subState,
    soakingElapsedMin: Number(soakingElapsedMin.toFixed(2)),
    soakingTargetMin: recipe.soakingTimeMin,
  };
}

export function tickIdleFurnace(
  prevState: FurnacePhysicsState | undefined,
  config: FurnaceConfig,
  effectiveTickMs: number,
  step: number,
): FurnacePhysicsState {
  const idleZoneCount = prevState?.zones.length || config.zones;
  const zones = Array.from({ length: idleZoneCount }, (_, index) => {
    const zoneId = index + 1;
    const previousZone = prevState?.zones.find((item) => item.zoneId === zoneId);
    const previousTemp = previousZone?.actualTempC ?? (config.maxTempC * 0.7);
    const standbySetpointC = Math.max(AMBIENT_TEMP_C + 180, (config.maxTempC * 0.72) - (index * 18));
    const previousBurnerLoadPct = previousZone?.burnerLoadPct ?? 14;
    const temperatureErrorC = standbySetpointC - previousTemp;
    const burnerLoadTargetPct = Math.max(
      6,
      Math.min(34, 12 + (temperatureErrorC * 0.22) + sensorOscillation(step, 1.2, 20, zoneId * 0.3)),
    );
    const burnerLoadPct = Number(firstOrderLag(previousBurnerLoadPct, burnerLoadTargetPct, effectiveTickMs, 45).toFixed(1));
    const heatingBiasC = ((burnerLoadPct - 12) / 22) * 18;
    const actualTempC = Number(firstOrderLag(previousTemp, standbySetpointC + heatingBiasC, effectiveTickMs, 240).toFixed(1));
    const measuredTempC = Number((actualTempC + sensorOscillation(step, 0.5, 12, zoneId * 0.4)).toFixed(1));
    const gasConsumptionNm3h = actualTempC > 180
      ? Number((((config.gasConsumptionNm3PerHour * 0.28) / idleZoneCount) * (burnerLoadPct / 100)).toFixed(2))
      : 0;
    const actualExhaustO2Pct = 3.1;
    const measuredExhaustO2Pct = Number((actualExhaustO2Pct + sensorOscillation(step, 0.08, 12, zoneId * 0.3)).toFixed(2));
    return {
      zoneId,
      setpointC: Number(standbySetpointC.toFixed(0)),
      actualTempC,
      measuredTempC,
      heaterOn: gasConsumptionNm3h > 0,
      gasConsumptionNm3h,
      burnerLoadPct,
      actualExhaustO2Pct,
      measuredExhaustO2Pct,
    };
  });
  const avgZoneTempC = zones.reduce((sum, zone) => sum + zone.actualTempC, 0) / Math.max(1, zones.length);
  const actualChamberTempC = Number(firstOrderLag(
    prevState?.actualChamberTempC ?? Math.max(AMBIENT_TEMP_C, avgZoneTempC - 10),
    Math.max(AMBIENT_TEMP_C, avgZoneTempC - 10),
    effectiveTickMs,
    180,
  ).toFixed(1));
  const measuredChamberTempC = Number((actualChamberTempC + sensorOscillation(step, 0.4, 14, 0.5)).toFixed(1));
  const actualFurnacePressurePa = Number((-6 + sensorOscillation(step, 1.2, 18, 0.2)).toFixed(1));
  const measuredFurnacePressurePa = Number((actualFurnacePressurePa + sensorOscillation(step, 0.4, 7, 0.9)).toFixed(1));
  const actualMaterialTempC = Number(firstOrderLag(
    prevState?.actualMaterialTempC ?? actualChamberTempC,
    actualChamberTempC,
    effectiveTickMs,
    300,
  ).toFixed(1));
  const measuredMaterialTempC = Number((actualMaterialTempC + sensorOscillation(step, 0.6, 16, 0.1)).toFixed(1));

  return {
    zones,
    slotMaterialIds: prevState?.slotMaterialIds ?? Array.from({ length: PUSHER_TOTAL_SLOTS }, () => ""),
    actualMaterialTempC,
    measuredMaterialTempC,
    actualChamberTempC,
    measuredChamberTempC,
    actualFurnacePressurePa,
    measuredFurnacePressurePa,
    pusherPositionPct: 0,
    pusherPushCount: 0,
    pusherSlotIndex: 1,
    pusherTotalSlots: PUSHER_TOTAL_SLOTS,
    pusherPaceMin: 0,
    nextPushProgressPct: 0,
    minutesToNextPush: 0,
    totalFuelFlowNm3h: Number(zones.reduce((sum, zone) => sum + zone.gasConsumptionNm3h, 0).toFixed(2)),
    totalAirFlowNm3h: Number(zones.reduce((sum, zone) => sum + (zone.gasConsumptionNm3h * 9.4 * 1.05), 0).toFixed(2)),
    subState: "IDLE",
    soakingElapsedMin: 0,
    soakingTargetMin: prevState?.soakingTargetMin ?? 0,
  };
}
