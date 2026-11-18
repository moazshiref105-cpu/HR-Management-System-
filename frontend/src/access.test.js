import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hasCapability } from "./access.js";
import { isImportExportSetupRequired, normalizeImportExportLoadError } from "./importExportErrors.js";

test("Super Admin wildcard grants navigation visibility for registered and future permissions", () => {
  assert.equal(hasCapability(["*"], "import_export.view"), true);
  assert.equal(hasCapability(["*"], "import_export.setup_projects.import"), true);
});

test("regular users see the center only with its view permission", () => {
  assert.equal(hasCapability(["employees.view"], "import_export.view"), false);
  assert.equal(hasCapability(["import_export.view"], "import_export.view"), true);
  assert.equal(hasCapability(["import_export.employees.import"], "import_export.view"), false);
});

test("Work Queues keeps the center visible and its group open on the selected route", () => {
  const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /hasCapability\(capabilities, "import_export\.view"\).*panelItem\("import-export", "Import & Export Center"/);
  assert.match(source, /\["project-staffing","import-export"\]\.includes\(page\)/);
  assert.match(source, /"import-export", "contracts", "lifecycle"/);
});

test("missing migration, authentication, authorization, and transient failures are distinct", () => {
  const migration = { code: "IMPORT_EXPORT_SETUP_REQUIRED", status: 503, message: "Apply the Import & Export migration." };
  assert.equal(isImportExportSetupRequired(normalizeImportExportLoadError(migration)), true);
  assert.match(normalizeImportExportLoadError(migration).message, /migration/i);
  assert.match(normalizeImportExportLoadError({ status: 401 }).message, /session has expired/i);
  assert.match(normalizeImportExportLoadError({ status: 403 }).message, /does not have permission/i);
  assert.match(normalizeImportExportLoadError(new TypeError("offline")).message, /connection and retry/i);
});
