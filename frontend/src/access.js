/** Capability wildcard is issued only by the backend for verified Super Admins. */
export const hasCapability = (capabilities, permission) =>
  Array.isArray(capabilities) && (capabilities.includes("*") || capabilities.includes(permission));
