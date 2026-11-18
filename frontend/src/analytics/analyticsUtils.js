export const dimensions = {
  department: "Department", team: "Team", position: "Position", project: "Project",
  governorate: "Governorate", employee_status: "Employee status", gender: "Gender",
  classification: "Classification", marital_status: "Marital status", religion: "Religion",
  diploma: "Diploma", leaving_reason: "Leaving reason", shift_type: "Shift type",
};

export const filterFields = {
  department_id: { resource: "departments", label: "Department" },
  team_id: { resource: "teams", label: "Team" },
  position_id: { resource: "positions", label: "Position" },
  project_id: { resource: "projects", label: "Project" },
  governorate_id: { resource: "governorates", label: "Governorate" },
  gender: { label: "Gender" }, employee_status: { label: "Employee status" },
  employee_classification: { label: "Classification" },
};

export const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—";
export const metricTitle = (labels, key) => labels[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const companyDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
};
const dateOnly = (year, month, day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const shiftMonth = (year, month, offset) => { const shifted = new Date(Date.UTC(year, month - 1 + offset, 1)); return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1]; };
export const currentYearRange = (now = new Date()) => {
  const { year, month, day } = companyDateParts(now);
  return { from: dateOnly(year, 1, 1), to: dateOnly(year, month, day) };
};
export const rangeFor = (key, now = new Date()) => {
  const { year, month, day } = companyDateParts(now); const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const endOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let from = dateOnly(year, month, day); let to = from;
  if (key === "month") from = dateOnly(year, month, 1);
  if (key === "last_month") { const [y, m] = shiftMonth(year, month, -1); from = dateOnly(y, m, 1); to = dateOnly(y, m, endOfMonth(y, m)); }
  if (key === "quarter") from = dateOnly(year, quarterMonth, 1);
  if (key === "last_quarter") { const [y, m] = shiftMonth(year, quarterMonth, -3); from = dateOnly(y, m, 1); to = dateOnly(y, m + 2, endOfMonth(y, m + 2)); }
  if (key === "trailing_12") { const [y, m] = shiftMonth(year, month, -11); from = dateOnly(y, m, 1); }
  if (key === "year") return currentYearRange(now);
  return { from, to };
};
