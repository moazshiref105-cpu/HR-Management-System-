<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\HttpException;
use Hms\Backend\ImportExportApi;
use Hms\Backend\ImportExportSchema;
use Hms\Backend\SetupApi;
use Hms\Backend\SupabaseRequestException;

function integrationAssert(bool $ok, string $message): void
{
    if (!$ok) throw new RuntimeException($message);
}

$registered = ['dashboard.view', 'import_export.view', 'import_export.setup_projects.import', 'import_export.setup_projects.export'];
$super = SetupApi::withSuperAdminMarker($registered, true);
$regular = SetupApi::withSuperAdminMarker(['employees.view', 'import_export.view'], false);
integrationAssert($super[0] === '*' && in_array('import_export.setup_projects.import', $super, true), 'Super Admin capability list must include a UI wildcard and all registered current permissions.');
integrationAssert(!in_array('*', $regular, true) && !in_array('import_export.setup_projects.import', $regular, true), 'Regular capability list must retain explicit role grants only.');

$api = new ReflectionClass(ImportExportApi::class);
$missingSchema = $api->getMethod('isImportExportMigrationMissing');
integrationAssert($missingSchema->invoke(null, new SupabaseRequestException(404, null, 'PGRST205')) === true, 'Missing PostgREST relation must be recognized as migration setup failure.');
integrationAssert($missingSchema->invoke(null, new SupabaseRequestException(404, null, 'PGRST202')) === true, 'Missing PostgREST RPC must be recognized as migration setup failure.');
integrationAssert($missingSchema->invoke(null, new SupabaseRequestException(404, null, 'PGRST116')) === false, 'Ordinary not-found responses must not be reported as missing migration.');

$migration = (string) file_get_contents(__DIR__ . '/../../supabase/migrations/20261118150000_add_import_export_center.sql');
foreach (ImportExportSchema::all() as $type => $schema) {
    foreach (['import', 'export'] as $direction) {
        $permission = $schema[$direction] ?? null;
        if (!is_string($permission)) continue;
        integrationAssert(str_contains($migration, "'{$permission}'"), "Migration is missing the {$direction} permission for {$type}.");
        integrationAssert(str_starts_with($permission, 'import_export.' . $type . '.'), "{$direction} permission must be independently scoped to {$type}.");
    }
}
$setup = (string) file_get_contents(__DIR__ . '/../src/SetupApi.php');
integrationAssert(str_contains($setup, "'/rest/v1/permissions?select=permission_key&order=permission_key'"), 'Super Admin capabilities must resolve from the live permission registry.');
integrationAssert(str_contains($setup, "'/rest/v1/permissions?select=id,permission_key,module,action,description&order=module,action'"), 'Roles screen permission catalog must use the live registry after migration.');
$rolesUi = (string) file_get_contents(__DIR__ . '/../../frontend/src/App.jsx');
integrationAssert(str_contains($rolesUi, 'setupApi.permissions(token)'), 'Roles & Permissions must show newly registered migration permissions.');
$apiSource = (string) file_get_contents(__DIR__ . '/../src/ImportExportApi.php');
integrationAssert(substr_count($apiSource, '$this->allow($actor,$schema[') >= 2, 'Import and export actions must check the selected data type permissions on the backend.');
integrationAssert(str_contains($apiSource, "\$schema['import_fields']") && str_contains($apiSource, "\$schema['export_fields']") && str_contains($apiSource, "unset(\$schema['fields'])"), 'Catalog must keep import and export field allowlists separate.');
$dispatchSource = substr($apiSource, strpos($apiSource, 'public function dispatch'), strpos($apiSource, 'private static function isImportExportMigrationMissing') - strpos($apiSource, 'public function dispatch'));
integrationAssert(str_contains($dispatchSource, "\$route===['exports']) \$result=\$this->export(\$actor)"), 'Export route must return the generated workbook download metadata to the client.');
$exportUi = (string) file_get_contents(__DIR__ . '/../../frontend/src/ImportExportCenter.jsx');
integrationAssert(str_contains($exportUi, 'schema?.export_fields||[]') && !str_contains($exportUi, 'schema.fields.map'), 'Export UI must select only backend-provided export fields.');
integrationAssert(str_contains($apiSource, '20261118150000_add_import_export_center.sql') && str_contains($apiSource, 'IMPORT_EXPORT_SETUP_REQUIRED'), 'Missing migration responses must carry a clear setup-specific error.');
$routes = (string) file_get_contents(__DIR__ . '/../../backend/public/index.php');
integrationAssert(str_contains($routes, "str_starts_with(\$path, 'api/import-export')"), 'Import & Export API route must be registered.');

echo "Import/export integration contracts passed\n";
