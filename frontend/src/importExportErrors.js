export const isImportExportSetupRequired = (error) => error?.code === "IMPORT_EXPORT_SETUP_REQUIRED";

export function normalizeImportExportLoadError(error) {
  if (isImportExportSetupRequired(error)) return error;
  if (error?.status === 401) return { ...error, message: "Your HMS session has expired. Sign in again to continue." };
  if (error?.status === 403) return { ...error, message: "Your account does not have permission to open the Import & Export Center. Ask an administrator to update your role." };
  if (!error?.status || error.status >= 500) return { ...error, message: "HMS could not be reached right now. Check your connection and retry." };
  return error;
}
