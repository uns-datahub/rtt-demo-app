export function normalizeHrmReqPath(path?: string): string {
  return typeof path === "string" ? path.replace(/^\/+|\/+$/g, "") : "";
}

export function extractSinglePathParam(path: string | undefined, baseSegments: string[]): string | null {
  const normalizedPath = normalizeHrmReqPath(path);
  const routeBase = baseSegments.join("/");

  if (!normalizedPath.startsWith(`${routeBase}/`)) {
    return null;
  }

  const suffix = normalizedPath.slice(routeBase.length + 1);
  if (!suffix || suffix.includes("/")) {
    return null;
  }

  return suffix;
}
