const DIRECTORY_PREFIX = "employees";

const hashRoute = () => location.hash.replace(/^#/, "");
const isDirectoryRoute = (route) =>
  route === DIRECTORY_PREFIX || route.startsWith(`${DIRECTORY_PREFIX}?`);

/** Keeps the complete directory/work-queue URL state through profile and edit routes. */
export const currentDirectoryContext = () => {
  const route = hashRoute();
  return isDirectoryRoute(route) ? route : DIRECTORY_PREFIX;
};

export const safeDirectoryContext = (candidate) => {
  if (!candidate || typeof candidate !== "string") return DIRECTORY_PREFIX;
  const decoded = candidate.replace(/^#/, "");
  return isDirectoryRoute(decoded) ? decoded : DIRECTORY_PREFIX;
};

export const profileDirectoryContext = () => {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return safeDirectoryContext(params.get("return_to"));
};

export const routeWithDirectoryContext = (route, context = currentDirectoryContext()) => {
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  params.set("return_to", safeDirectoryContext(context));
  return `${path}?${params.toString()}`;
};

export const profileRouteFromDirectory = (employeeId, context) =>
  routeWithDirectoryContext(`${DIRECTORY_PREFIX}/${employeeId}`, context);

export const editRouteFromProfile = (employeeId) =>
  (() => {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const route = `${DIRECTORY_PREFIX}/${employeeId}/edit${params.get("section") ? `?section=${encodeURIComponent(params.get("section"))}` : ""}`;
    return routeWithDirectoryContext(route, profileDirectoryContext());
  })();

export const profileRouteFromEditor = (employeeId) => {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const route = `${DIRECTORY_PREFIX}/${employeeId}${params.get("section") ? `?section=${encodeURIComponent(params.get("section"))}` : ""}`;
  return routeWithDirectoryContext(route, profileDirectoryContext());
};
