import type { HrmProductionLine } from "../hrm-production-line.js";
import type { FurnaceZoneSetpoint, Recipe } from "../hrm-types.js";

type RecipePatch = {
  targetTempC?: number;
  pusherPaceMin?: number;
  stoichiometricRatioTarget?: number;
  soakingTimeMin?: number;
  zones?: FurnaceZoneSetpoint[];
};

type ParseRecipeUpdateResult =
  | { ok: true; value: RecipePatch }
  | { ok: false; error: string };

export function getRecipes(line: HrmProductionLine): Recipe[] {
  return line.getRecipes();
}

export function getRecipeById(line: HrmProductionLine, recipeId: string | null): { ok: true; value: Recipe } | { ok: false; error: string } {
  if (!recipeId) {
    return { ok: false, error: "Recipe path not found" };
  }
  const recipe = line.getRecipe(recipeId);
  if (!recipe) {
    return { ok: false, error: `Recipe '${recipeId}' not found` };
  }
  return { ok: true, value: recipe };
}

export function updateRecipe(
  line: HrmProductionLine,
  recipeId: string | null,
  body: Record<string, unknown> | undefined,
): { ok: true; value: Recipe } | { ok: false; error: string } {
  if (!recipeId) {
    return { ok: false, error: "Recipe path not found" };
  }
  const parsed = parseRecipePatch(body);
  if (!parsed.ok) {
    return parsed;
  }
  const recipe = line.updateRecipe(recipeId, parsed.value);
  if (!recipe) {
    return { ok: false, error: `Recipe '${recipeId}' not found` };
  }
  return { ok: true, value: recipe };
}

function parseRecipePatch(body: Record<string, unknown> | undefined): ParseRecipeUpdateResult {
  const patchBody = body?.["furnace"];
  const furnace = (typeof patchBody === "object" && patchBody !== null ? patchBody : body) as Record<string, unknown> | undefined;
  if (!furnace) {
    return { ok: false, error: "Recipe update body is required" };
  }

  const patch: RecipePatch = {};
  const assignPositiveNumber = (key: keyof RecipePatch, value: unknown): string | null => {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return `${String(key)} must be a positive number`;
    }
    patch[key] = value as never;
    return null;
  };

  for (const key of ["targetTempC", "pusherPaceMin", "stoichiometricRatioTarget", "soakingTimeMin"] as const) {
    const error = assignPositiveNumber(key, furnace[key]);
    if (error) return { ok: false, error };
  }

  if (furnace["zones"] != null) {
    if (!Array.isArray(furnace["zones"]) || furnace["zones"].length === 0) {
      return { ok: false, error: "zones must be a non-empty array when provided" };
    }
    const zones: FurnaceZoneSetpoint[] = [];
    for (const zone of furnace["zones"]) {
      if (typeof zone !== "object" || zone === null) {
        return { ok: false, error: "zone entries must be objects" };
      }
      const zoneId = (zone as Record<string, unknown>)["zoneId"];
      const setpointC = (zone as Record<string, unknown>)["setpointC"];
      if (
        typeof zoneId !== "number" || !Number.isInteger(zoneId) || zoneId <= 0
        || typeof setpointC !== "number" || !Number.isFinite(setpointC) || setpointC <= 0
      ) {
        return { ok: false, error: "each zone must include positive numeric zoneId and setpointC" };
      }
      zones.push({ zoneId, setpointC });
    }
    patch.zones = zones;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No valid furnace recipe fields supplied for update" };
  }

  return { ok: true, value: patch };
}
