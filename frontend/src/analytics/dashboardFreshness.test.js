import assert from "node:assert/strict";
import test from "node:test";
import { createDashboardApi } from "../dashboardApi.js";
import { dashboardRequestKey, nextDashboardRefreshSequence, resolveDashboardRequestState } from "./dashboardFreshness.js";

test("every Dashboard API call bypasses the browser cache", async () => {
  const calls = [];
  const client = createDashboardApi(async (...args) => { calls.push(args); return {}; });
  await Promise.all([
    client.executive({ from: "2026-01-01" }, "token"),
    client.overview({ metric: "active_employees", page: 2 }, "token"),
    client.secondary({}, "token"),
    client.filterOptions("token"),
    client.summary({}, "token"),
    client.analysis({}, "token"),
    client.employees({}, "token"),
    client.attention({}, "token"),
    client.dimensions("token"),
    client.metrics("token"),
    client.options("token"),
    client.trend({}, "token"),
  ]);
  assert.equal(calls.length, 12);
  assert.ok(calls.every(([, , options]) => options.cache === "no-store"));
  assert.ok(calls.some(([path]) => path.includes("/api/dashboard/executive?from=2026-01-01")));
  assert.ok(calls.some(([path]) => path.includes("/api/dashboard/overview?metric=active_employees&page=2")));
});

test("an old result is not returned after refresh failure", () => {
  const requestKey = "filters:refresh-2";
  const state = resolveDashboardRequestState(
    { key: "filters:refresh-1", data: { kpis: { total_employees: 207 } } },
    { key: requestKey, message: "Dashboard request failed." },
    requestKey,
    false,
  );
  assert.equal(state.data, null);
  assert.equal(state.error, "Dashboard request failed.");
  assert.equal(state.loading, false);
});

test("refresh changes the request key without changing selected filters", () => {
  const filters = { view: "explorer", from: "2026-01-01", department_id: "12", metric: "active_employees" };
  const unchangedFilters = structuredClone(filters);
  const before = dashboardRequestKey(filters, 4);
  const nextSequence = nextDashboardRefreshSequence(4);
  const after = dashboardRequestKey(filters, nextSequence);
  assert.notEqual(after, before);
  assert.deepEqual(filters, unchangedFilters);
});
