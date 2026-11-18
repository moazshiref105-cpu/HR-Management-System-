const queryPath = (route, params) => `/api/dashboard/${route}?${new URLSearchParams(params)}`;

/** Dashboard-only request client. Every GET bypasses the browser's HTTP cache. */
export function createDashboardApi(request, dedupe = (_key, run) => run()) {
  const get = (path, token) => request(path, token, { cache: "no-store" });
  return {
    metrics: (token) => dedupe(`GET:${token}:/api/dashboard/metrics`, () => get("/api/dashboard/metrics", token)),
    executive: (params, token) => get(queryPath("executive", params), token),
    overview: (params, token) => get(queryPath("overview", params), token),
    secondary: (params, token) => get(queryPath("secondary", params), token),
    filterOptions: (token) => get("/api/dashboard/filter-options", token),
    summary: (params, token) => get(queryPath("summary", params), token),
    analysis: (params, token) => get(queryPath("analysis", params), token),
    employees: (params, token) => get(queryPath("employees", params), token),
    attention: (params, token) => get(queryPath("attention", params), token),
    dimensions: (token) => get("/api/dashboard/dimensions", token),
    options: (token) => dedupe(`GET:${token}:/api/dashboard/options`, () => get("/api/dashboard/options", token)),
    trend: (params, token) => get(queryPath("trend", params), token),
  };
}
