const BASE = import.meta.env.VITE_API_BASE_URL || ''

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
  master: (resource, t) => api(`/api/setup/master-data/${resource}`, t), insurance: (t) => api('/api/setup/insurance-settings', t),
  createUser: (body, t) => api('/api/setup/users', t, { method: 'POST', body: JSON.stringify(body) }),
  patchUser: (id, body, t) => api(`/api/setup/users/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  userStatus: (id, is_active, t) => api(`/api/setup/users/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  userRoles: (id, role_ids, t) => api(`/api/setup/users/${id}/roles`, t, { method: 'PUT', body: JSON.stringify({ role_ids }) }),
  createRole: (body, t) => api('/api/setup/roles', t, { method: 'POST', body: JSON.stringify(body) }),
  patchRole: (id, body, t) => api(`/api/setup/roles/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  roleStatus: (id, is_active, t) => api(`/api/setup/roles/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  rolePermissions: (id, permission_ids, t) => api(`/api/setup/roles/${id}/permissions`, t, { method: 'PUT', body: JSON.stringify({ permission_ids }) }),
  createMaster: (resource, body, t) => api(`/api/setup/master-data/${resource}`, t, { method: 'POST', body: JSON.stringify(body) }),
  patchMaster: (resource, id, body, t) => api(`/api/setup/master-data/${resource}/${id}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
  masterStatus: (resource, id, is_active, t) => api(`/api/setup/master-data/${resource}/${id}/status`, t, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  patchInsurance: (key, body, t) => api(`/api/setup/insurance-settings/${key}`, t, { method: 'PATCH', body: JSON.stringify(body) }),
}
