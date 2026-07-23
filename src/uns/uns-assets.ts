// Generated UNS asset list. Run `pnpm run sync-uns-metadata` to update.
export const GeneratedAssets = {
  "archiver": "archiver",
  "hrm": "hrm",
  /** Hydraulic Descaling */
  "hrm-descaling": "hrm-descaling",
  /** Potisna peč (reheating furnace) */
  "hrm-pusher-furnace": "hrm-pusher-furnace",
  /** Čakalna vrsta proizvodnje */
  "hrm-queue": "hrm-queue",
  /** Reversing Rolling Stand */
  "hrm-stand-1": "hrm-stand-1",
  /** Warehouse & Quality Lab */
  "hrm-warehouse": "hrm-warehouse",
} as const;
export type GeneratedAssetName = typeof GeneratedAssets[keyof typeof GeneratedAssets];

export function resolveGeneratedAsset(name: keyof typeof GeneratedAssets): (typeof GeneratedAssets)[keyof typeof GeneratedAssets];
export function resolveGeneratedAsset<T extends string>(name: T): (typeof GeneratedAssets)[keyof typeof GeneratedAssets] | T;
export function resolveGeneratedAsset(name: string): string {
  return (GeneratedAssets as Record<string, string>)[name] ?? name;
}
