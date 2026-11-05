// Shared People Operations queue contract. The backend remains authoritative
// for membership and permission checks; this safely describes presentation.
const queueDefinitions = {
  medical_eligible: { title: "Employees eligible for Medical Insurance", subtitle: "Employees who meet the configured medical insurance eligibility requirement.", dateLabel: "Eligibility date", columns: ["item", "queueDate", "days"] },
  medical_not_yet_eligible: { title: "Employees not yet eligible for Medical Insurance", subtitle: "Employees who have not yet reached the configured medical insurance eligibility date.", dateLabel: "Eligibility date", columns: ["item", "queueDate", "days"] },
  life_eligible: { title: "Employees eligible for Life Insurance", subtitle: "Employees who meet the configured life insurance eligibility requirement.", dateLabel: "Eligibility date", columns: ["item", "queueDate", "days"] },
  contracts_expiring: { title: "Employees needing contract renewal", subtitle: "Employees with contracts ending in the selected period.", dateLabel: "Contract expiration", columns: ["queueDate", "days"] },
  contracts_expired: { title: "Employees with expired contracts", subtitle: "Employees whose contract expiration date has passed.", dateLabel: "Contract expiration", columns: ["queueDate", "days"] },
  identity_expiring: { title: "Employees with identity documents expiring", subtitle: "Employees whose identity documents expire in the selected period.", dateLabel: "Identity expiration", columns: ["queueDate", "days"] },
  identity_expired: { title: "Employees with expired identity documents", subtitle: "Employees whose identity document expiration date has passed.", dateLabel: "Identity expiration", columns: ["queueDate", "days"] },
  licenses_expiring: { title: "Employees with licenses expiring", subtitle: "Employees with a license expiring in the selected period.", dateLabel: "License expiration", columns: ["item", "queueDate", "days"] },
  licenses_expired: { title: "Employees with expired licenses", subtitle: "Employees with a license whose expiration date has passed.", dateLabel: "License expiration", columns: ["item", "queueDate", "days"] },
  missing_form_1: { title: "Employees missing Form 1", subtitle: "Employees whose Form 1 record is incomplete.", dateLabel: "Form 1 deadline", columns: ["item", "queueDate"] },
  missing_form_6: { title: "Employees missing Form 6", subtitle: "Former employees whose Form 6 record is incomplete.", dateLabel: "Relevant date", columns: ["item", "queueDate"] },
  missing_bank: { title: "Employees missing bank details", subtitle: "Employees without the required bank account record.", columns: ["item", "joining"] },
  in_probation: { title: "Employees in probation", subtitle: "Employees currently within their probation period.", dateLabel: "Probation due", columns: ["queueDate", "days"] },
  probation_due: { title: "Employees with probation due", subtitle: "Employees whose probation milestone falls in the selected period.", dateLabel: "Probation due", columns: ["queueDate", "days"] },
  due_soon: { title: "Employees with HR actions due soon", subtitle: "Employees with open HR actions due in the next period.", columns: ["queueDate", "status"] },
  overdue: { title: "Employees with overdue HR actions", subtitle: "Employees with open HR actions that are overdue.", columns: ["queueDate", "status"] },
  open_notifications: { title: "Employees with open HR actions", subtitle: "Employees with an active HR notification requiring follow-up.", columns: ["queueDate", "status"] },
  new_hires: { title: "New hires", subtitle: "Employees who joined during the selected period.", dateLabel: "Joining date", columns: ["queueDate", "status"] },
  resigned_employees: { title: "Resigned employees", subtitle: "Employees who resigned during the selected period.", dateLabel: "Leaving date", columns: ["queueDate", "status"] },
};

export const workQueue = (key) => queueDefinitions[key] || null;
export const workQueueDefinitions = Object.freeze(queueDefinitions);

export const workQueueHash = (key, params = {}) => {
  const query = new URLSearchParams({ queue: key, ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== "" && value != null)) });
  return `employees?${query}`;
};
