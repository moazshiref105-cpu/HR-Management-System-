import { api } from "./api";

const BASE = import.meta.env.VITE_API_BASE_URL || "";
const route = (suffix) => `${BASE}/api/import-export${suffix}`;
async function download(path, token) {
  const response = await fetch(route(path), { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error("The workbook could not be downloaded. Try again.");
  return response.blob();
}
export const importExportApi = {
  catalog: (token) => api("/api/import-export/catalog", token, { cache: "no-store" }),
  jobs: (token) => api("/api/import-export/imports", token, { cache: "no-store" }),
  template: (type, token) => download(`/template?type=${encodeURIComponent(type)}`, token),
  upload: async (type, file, token) => {
    const form = new FormData(); form.append("type", type); form.append("workbook", file);
    const response = await fetch(route("/imports"), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || "The workbook could not be checked.");
    return payload.data;
  },
  job: (id, token) => api(`/api/import-export/imports/${encodeURIComponent(id)}`, token, { cache: "no-store" }),
  confirm: (id, token) => api(`/api/import-export/imports/${encodeURIComponent(id)}/confirm`, token, { method: "POST", body: "{}", cache: "no-store" }),
  resume: (id, token) => api(`/api/import-export/imports/${encodeURIComponent(id)}/resume`, token, { method: "POST", body: "{}", cache: "no-store" }),
  retry: (id, token) => api(`/api/import-export/imports/${encodeURIComponent(id)}/retry`, token, { method: "POST", body: "{}", cache: "no-store" }),
  report: (id, token) => download(`/imports/${encodeURIComponent(id)}/report`, token),
  preview: (params, token) => api(`/api/import-export/export-preview?${new URLSearchParams(params)}`, token, { cache: "no-store" }),
  export: async (body, token) => {
    const result = await api("/api/import-export/exports", token, { method: "POST", body: JSON.stringify(body), cache: "no-store" });
    if (!result || typeof result.download_url !== "string" || !result.download_url) {
      throw new Error("HMS created no usable download link. Refresh the page and try again. If this continues, restart the local PHP API server so it loads the latest export fix.");
    }
    return result;
  },
  exportDownload: (id, token) => api(`/api/import-export/exports/${encodeURIComponent(id)}/download`, token, { cache: "no-store" }),
};
