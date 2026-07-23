import {
  defineDataCatalogField,
  defineDataCatalogQueryParam,
  defineDataCatalogSchema,
  defineServiceApi,
  type ApiHandler,
  type ServiceApiRegistration,
} from "@uns-kit/api";
import type { HrmProductionLine } from "./hrm/hrm-production-line.js";
import { getBatchById, submitBatch } from "./hrm/services/batch-service.js";
import { getRecipeById, getRecipes, updateRecipe } from "./hrm/services/recipe-service.js";
import { getProductionLineState } from "./hrm/services/status-service.js";

export type AppApiContext = {
  line: HrmProductionLine;
  processName: string;
};

const hrmServiceRoute = {
  topic: "system",
  asset: "hrm",
  objectType: "service",
} as const;

function getQueryParam(req: { query?: unknown }, key: string): string | null {
  const query = req.query;
  if (!query || typeof query !== "object") {
    return null;
  }

  const value = (query as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const batchSubmitSchema = defineDataCatalogSchema({
  id: "hrm-batch-submit-request",
  title: "HRM Batch Submit Request",
  contentType: "application/json",
  fields: [
    defineDataCatalogField("recipeId", "string", "Recipe identifier", {
      required: true,
      example: "s355-20mm",
    }),
    defineDataCatalogField("materialId", "string", "Material slab identifier", {
      required: true,
      example: "slab-001",
    }),
    defineDataCatalogField("quantity", "number", "Number of units to produce", {
      required: true,
      example: 1,
    }),
  ],
});

const recipeUpdateSchema = defineDataCatalogSchema({
  id: "hrm-recipe-update-request",
  title: "HRM Recipe Update Request",
  contentType: "application/json",
  fields: [
    defineDataCatalogField("targetTempC", "number", "Target furnace temperature", { example: 1200 }),
    defineDataCatalogField("pusherPaceMin", "number", "Pusher pace in minutes", { example: 2.5 }),
    defineDataCatalogField("stoichiometricRatioTarget", "number", "Target stoichiometric ratio", { example: 1.05 }),
    defineDataCatalogField("soakingTimeMin", "number", "Soaking time in minutes", { example: 15 }),
    defineDataCatalogField("zones", "array", "Optional furnace zone setpoints"),
    defineDataCatalogField("zoneId", "integer", "Zone identifier", {
      path: "zones[].zoneId",
      example: 1,
    }),
    defineDataCatalogField("setpointC", "number", "Zone setpoint temperature", {
      path: "zones[].setpointC",
      example: 1180,
    }),
  ],
});

const statusHandler: ApiHandler<"GET", AppApiContext> = async (event, { line }) => {
  event.res.json(getProductionLineState(line));
};

const configHandler: ApiHandler<"GET", AppApiContext> = async (event, { line }) => {
  event.res.json(line.getRuntimeConfig());
};

const batchGetHandler: ApiHandler<"GET", AppApiContext> = async (event, { line }) => {
  const batchId = getQueryParam(event.req, "batchId");
  if (!batchId) {
    event.res.status(400).json({ error: "Missing required query parameter: batchId" });
    return;
  }

  const result = getBatchById(line, batchId);
  if (!result.ok) {
    event.res.status(404).json({ error: result.error });
    return;
  }

  event.res.json(result.value);
};

const batchPostHandler: ApiHandler<"POST", AppApiContext> = async (event, { line }) => {
  const result = submitBatch(line, event.req.body as Record<string, unknown> | undefined);
  if (!result.ok) {
    event.res.status(400).json({ error: result.error });
    return;
  }

  event.res.status(result.statusCode).json(result.value);
};

const recipesHandler: ApiHandler<"GET", AppApiContext> = async (event, { line }) => {
  event.res.json({ recipes: getRecipes(line) });
};

const recipeGetHandler: ApiHandler<"GET", AppApiContext> = async (event, { line }) => {
  const recipeId = getQueryParam(event.req, "recipeId");
  if (!recipeId) {
    event.res.status(400).json({ error: "Missing required query parameter: recipeId" });
    return;
  }

  const result = getRecipeById(line, recipeId);
  if (!result.ok) {
    event.res.status(404).json({ error: result.error });
    return;
  }

  event.res.json(result.value);
};

const recipePostHandler: ApiHandler<"POST", AppApiContext> = async (event, { line }) => {
  const recipeId = getQueryParam(event.req, "recipeId");
  if (!recipeId) {
    event.res.status(400).json({ error: "Missing required query parameter: recipeId" });
    return;
  }

  const result = updateRecipe(line, recipeId, event.req.body as Record<string, unknown> | undefined);
  if (!result.ok) {
    event.res.status(400).json({ error: result.error });
    return;
  }

  event.res.json(result.value);
};

export const serviceApis = {
  status: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "status",
    method: "GET",
    description: "HRM production line status - all stations, queue, completed batches",
    tags: ["hrm"],
    handler: statusHandler,
  }),
  config: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "config",
    method: "GET",
    description: "HRM simulator runtime config needed by external services",
    tags: ["hrm"],
    handler: configHandler,
  }),
  batch: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "batch",
    method: "GET",
    description: "HRM batch details - query by batchId using ?batchId=...",
    tags: ["hrm"],
    queryParams: [
      defineDataCatalogQueryParam("batchId", "HRM batch identifier", {
        required: true,
      }),
    ],
    handler: batchGetHandler,
  }),
  submitBatch: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "batch",
    method: "POST",
    description: "Submit a new batch to the HRM production line",
    tags: ["hrm"],
    requestBody: {
      required: true,
      description: "Batch submission payload",
      contentType: "application/json",
      schemas: [batchSubmitSchema],
    },
    handler: batchPostHandler,
  }),
  recipes: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "recipe-map",
    method: "GET",
    description: "HRM recipe map - list all simulator recipes",
    tags: ["hrm"],
    handler: recipesHandler,
  }),
  recipe: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "recipe",
    method: "GET",
    description: "HRM recipe detail - query by recipeId using ?recipeId=...",
    tags: ["hrm"],
    queryParams: [
      defineDataCatalogQueryParam("recipeId", "HRM recipe identifier", {
        required: true,
      }),
    ],
    handler: recipeGetHandler,
  }),
  updateRecipe: defineServiceApi({
    ...hrmServiceRoute,
    attribute: "recipe",
    method: "POST",
    description: "Update an HRM recipe in-memory for queued/active batches using ?recipeId=...",
    tags: ["hrm"],
    queryParams: [
      defineDataCatalogQueryParam("recipeId", "HRM recipe identifier", {
        required: true,
      }),
    ],
    requestBody: {
      required: true,
      description: "Partial furnace recipe update payload",
      contentType: "application/json",
      schemas: [recipeUpdateSchema],
    },
    handler: recipePostHandler,
  }),
} satisfies Record<string, ServiceApiRegistration>;
