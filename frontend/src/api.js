const BASE = import.meta.env.VITE_API_BASE_URL || ''
const MASTER_RESOURCES = new Set([
  'religions', 'marital-statuses', 'diplomas', 'governorates', 'departments',
  'shift-types', 'teams', 'positions', 'projects', 'banks', 'leaving-reasons',
  'license-types',
])
const masterPath = (resource) => {
  if (!MASTER_RESOURCES.has(resource)) throw new Error('Unknown master-data resource.')
  return `/api/setup/master-data/${resource}`
}

export async function api(path, token, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'The request could not be completed.')
  return payload.data
}

export const setupApi = {
  users: (t) => api('/api/setup/users', t), roles: (t) => api('/api/setup/roles', t), permissions: (t) => api('/api/setup/permissions', t),
  capabilities: (t) => api('/api/setup/capabilities', t),
  master: (resource, t) => api(masterPath(resource), t), insurance: (t) => api('/api/setup/insurance-settings', t),
  createUser: (body, t) => api('/api/setup/users', t, { method: 'POST', body: JSON.stringify(body) }),
  patchUser: (id, body, t) => api(`/api/setup/users/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  userStatus: (id, is_active, t) => api(`/api/setup/users/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  userRoles: (id, role_ids, t) => api(`/api/setup/users/${id}/roles`, t, { method: 'PUT', body: JSON.stringify({ role_ids }) }),
  createRole: (body, t) => api('/api/setup/roles', t, { method: 'POST', body: JSON.stringify(body) }),
  patchRole: (id, body, t) => api(`/api/setup/roles/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  roleStatus: (id, is_active, t) => api(`/api/setup/roles/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  rolePermissions: (id, permission_ids, t) => api(`/api/setup/roles/${id}/permissions`, t, { method: 'PUT', body: JSON.stringify({ permission_ids }) }),
  createMaster: (resource, body, t) => api(masterPath(resource), t, { method: 'POST', body: JSON.stringify(body) }),
  patchMaster: (resource, id, body, t) => api(`${masterPath(resource)}/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  masterStatus: (resource, id, is_active, t) => api(`${masterPath(resource)}/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  patchInsurance: (key, body, t) => api(`/api/setup/insurance-settings/${key}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
}

export const employeesApi = {
  listEmployees: (params, t) => {
    const query = new URLSearchParams(Object.entries(params || {}).filter(([, value]) => value !== "" && value != null)).toString()
    return api(`/api/employees${query ? `?${query}` : ""}`, t)
  },
  getEmployee: (id, t) => api(`/api/employees/${id}`, t),
  createEmployee: (body, t) => api('/api/employees', t, { method: 'POST', body: JSON.stringify(body) }),
  updateEmployee: (id, body, t) => api(`/api/employees/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  updateEmployeeStatus: (id, body, t) => api(`/api/employees/${id}/status`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  addWife: (id, body, t) => api(`/api/employees/${id}/wives`, t, { method: 'POST', body: JSON.stringify(body) }),
  updateWife: (id, wifeId, body, t) => api(`/api/employees/${id}/wives/${wifeId}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  addChild: (id, body, t) => api(`/api/employees/${id}/children`, t, { method: 'POST', body: JSON.stringify(body) }),
  updateChild: (id, childId, body, t) => api(`/api/employees/${id}/children/${childId}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  addLicense: (id, body, t) => api(`/api/employees/${id}/licenses`, t, { method: 'POST', body: JSON.stringify(body) }),
  updateLicense: (id, licenseId, body, t) => api(`/api/employees/${id}/licenses/${licenseId}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  renewContract: (id, body, t) => api(`/api/employees/${id}/contract-renewals`, t, { method: 'POST', body: JSON.stringify(body) }),
  refreshEmployeeNotifications: (id, t) => api(`/api/employees/${id}/notifications`, t, { method: 'POST' }),
}

export const dashboardApi = {
  overview: (params, t) => api(`/api/dashboard/overview?${new URLSearchParams(params)}`, t),
  secondary: (params, t) => api(`/api/dashboard/secondary?${new URLSearchParams(params)}`, t),
  filterOptions: (t) => api('/api/dashboard/filter-options', t),
  summary: (params, t) => api(`/api/dashboard/summary?${new URLSearchParams(params)}`, t),
  analysis: (params, t) => api(`/api/dashboard/analysis?${new URLSearchParams(params)}`, t),
  employees: (params, t) => api(`/api/dashboard/employees?${new URLSearchParams(params)}`, t),
  attention: (params, t) => api(`/api/dashboard/attention?${new URLSearchParams(params)}`, t),
  dimensions: (t) => api('/api/dashboard/dimensions', t),
  options: (t) => api('/api/dashboard/options', t),
  trend: (params, t) => api(`/api/dashboard/trend?${new URLSearchParams(params)}`, t),
}
