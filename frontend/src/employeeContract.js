import contract from "../../shared/employee-contract.json";

export const EMPLOYEE_STATUSES = Object.freeze(contract.employee_statuses);
export const EMPLOYEE_CLASSIFICATIONS = Object.freeze(contract.employee_classifications);
export const DIRECTORY_DEFAULTS = Object.freeze(contract.directory_defaults);

export const normalizeEmployeeClassification = (value) => {
  if (value === "5%" || value === "five_percent") return "5_percent";
  return value;
};

export const employeeStatusLabel = (status) => ({
  active: "Active",
  resigned: "Resigned",
}[status] || "Status unavailable");

export const employeeClassificationLabel = (classification) =>
  EMPLOYEE_CLASSIFICATIONS.find(({ value }) => value === normalizeEmployeeClassification(classification))?.label || "Standard";
