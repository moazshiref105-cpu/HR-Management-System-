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

export const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`)) : "—";
export const metricTitle = (labels, key) => labels[key] || key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const currentYearRange = () => {
  const now = new Date();
  return { from: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};
export const rangeFor = (key) => {
  const now = new Date(); let from = new Date(now); let to = new Date(now);
  if (key === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  if (key === "last_month") { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  if (key === "quarter") from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (key === "last_quarter") { const quarter = Math.floor(now.getMonth() / 3); from = new Date(now.getFullYear(), (quarter - 1) * 3, 1); to = new Date(now.getFullYear(), quarter * 3, 0); }
  if (key === "trailing_12") from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  if (key === "year") return currentYearRange();
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};
