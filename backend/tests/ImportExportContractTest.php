<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hms\Backend\ImportExportApi;
use Hms\Backend\ImportExportSchema;
use Hms\Backend\ImportExportWorkbook;

function importExportAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function templateFixture(string $type, array $fields, string $marker = '', bool $formula = false): string
{
    $path=tempnam(sys_get_temp_dir(),'hms-test-xlsx-');
    $bytes=ImportExportWorkbook::template(array_merge(ImportExportSchema::get($type),['fields'=>$fields]),$type);
    file_put_contents($path,$bytes);
    $zip=new ZipArchive();
    if($zip->open($path)!==true) throw new RuntimeException('Could not open synthetic workbook fixture.');
    $sheet=$zip->getFromName('xl/worksheets/sheet2.xml');
    if(!is_string($sheet)) throw new RuntimeException('Synthetic workbook has no Data sheet.');
    if($marker!=='') $sheet=str_replace('HMS_TEMPLATE|' . $type . '|1',$marker,$sheet);
    $cell=$formula?'<c r="A3"><f>1+1</f><v>2</v></c>':'<c r="A3" t="inlineStr"><is><t>SYNTHETIC-ONLY</t></is></c>';
    $sheet=str_replace('</sheetData>','<row r="3">' . $cell . '</row></sheetData>',$sheet);
    $zip->addFromString('xl/worksheets/sheet2.xml',$sheet);
    $zip->close();
    return $path;
}

$departmentSchema=ImportExportSchema::get('setup_departments');
$fixture=templateFixture('setup_departments',$departmentSchema['fields']);
try {
    $parsed=ImportExportWorkbook::parse($fixture,'setup_departments',$departmentSchema['fields']);
    importExportAssert($parsed['version']===ImportExportSchema::VERSION,'Template schema marker did not round-trip.');
    importExportAssert(count($parsed['rows'])===1 && $parsed['rows'][0]['data']['name']==='SYNTHETIC-ONLY','Workbook parser did not preserve a synthetic data row.');
} finally { @unlink($fixture); }

$outdated=templateFixture('setup_departments',$departmentSchema['fields'],'HMS_TEMPLATE|setup_departments|99');
try {
    $rejected=false; try { ImportExportWorkbook::parse($outdated,'setup_departments',$departmentSchema['fields']); } catch (RuntimeException $error) { $rejected=str_contains($error->getMessage(),'outdated'); }
    importExportAssert($rejected,'Outdated template should be rejected with an actionable message.');
} finally { @unlink($outdated); }

$formula=templateFixture('setup_departments',$departmentSchema['fields'],'',true);
try {
    $rejected=false; try { ImportExportWorkbook::parse($formula,'setup_departments',$departmentSchema['fields']); } catch (RuntimeException $error) { $rejected=str_contains($error->getMessage(),'Formula cells are not accepted'); }
    importExportAssert($rejected,'Formula cells should be rejected with a safe explanation.');
} finally { @unlink($formula); }

$malformed=tempnam(sys_get_temp_dir(),'hms-malformed-'); file_put_contents($malformed,'not an xlsx archive');
try {
    try { ImportExportWorkbook::parse($malformed,'setup_departments',$departmentSchema['fields']); throw new RuntimeException('Malformed workbook was accepted.'); } catch (RuntimeException $error) { importExportAssert(!str_contains($error->getMessage(),'Malformed workbook was accepted'),'Malformed workbook should be rejected.'); }
} finally { @unlink($malformed); }

$oversized=tempnam(sys_get_temp_dir(),'hms-oversized-'); file_put_contents($oversized,str_repeat('x',ImportExportWorkbook::MAX_FILE_BYTES+1));
try {
    try { ImportExportWorkbook::parse($oversized,'setup_departments',$departmentSchema['fields']); throw new RuntimeException('Oversized workbook was accepted.'); } catch (RuntimeException $error) { importExportAssert(str_contains($error->getMessage(),'2 MB'),'Oversized workbook should explain the limit.'); }
} finally { @unlink($oversized); }

$api=(new ReflectionClass(ImportExportApi::class))->newInstanceWithoutConstructor();
$validate=new ReflectionMethod(ImportExportApi::class,'validateValue');
importExportAssert($validate->invoke($api,'five_percent',['key'=>'employee_classification','type'=>'enum','values'=>['standard','five_percent']])===null,'Allowed employee classification was rejected.');
importExportAssert($validate->invoke($api,'5_percent',['key'=>'employee_classification','type'=>'enum','values'=>['standard','five_percent']])!==null,'Database-incompatible employee classification was accepted.');
importExportAssert($validate->invoke($api,'unknown',['key'=>'employee_classification','type'=>'enum','values'=>['standard','five_percent']])!==null,'Unknown enum value was accepted.');
importExportAssert($validate->invoke($api,'12345678901234',['key'=>'identity_card_number','type'=>'text'])===null,'Valid National ID text was rejected.');
importExportAssert($validate->invoke($api,'123',['key'=>'identity_card_number','type'=>'text'])!==null,'Invalid National ID length was accepted.');
importExportAssert($validate->invoke($api,'-1',['key'=>'planned_count','type'=>'integer'])!==null,'Negative planned headcount was accepted.');
importExportAssert($validate->invoke($api,'2026-02-30',['key'=>'date','type'=>'date'])!==null,'Invalid calendar date was accepted.');
$natural=new ReflectionMethod(ImportExportApi::class,'naturalKey');
importExportAssert($natural->invoke($api,'children',['employee_number'=>100,'identity_card_number'=>'00000000000001'])==='children:100|00000000000001','Employee-linked duplicate matching key is incorrect.');
importExportAssert($natural->invoke($api,'social_insurance',['employee_number'=>100])==='social_insurance:100','Social Insurance must match one record per Employee Number.');
$selectFields=new ReflectionMethod(ImportExportApi::class,'selectedFields');
importExportAssert($selectFields->invoke($api,'name',[['key'=>'name','label'=>'Name']])[0]['key']==='name','Permitted export fields were not retained.');
try { $selectFields->invoke($api,'secret',[['key'=>'name','label'=>'Name']]); throw new RuntimeException('Unpermitted export field was accepted.'); } catch (ReflectionException|Hms\Backend\HttpException) {}

$employeeSchema=ImportExportSchema::get('employees');
importExportAssert(in_array('employee_number',array_column($employeeSchema['fields'],'key'),true),'Employee template must offer the existing HMS Employee Number key.');
importExportAssert(in_array('source_reference',array_column($employeeSchema['fields'],'key'),true),'Employee template must capture a source reference for generated-number mapping.');
foreach(['bank_name','bank_account_number'] as $financialField) importExportAssert(in_array($financialField,array_column($employeeSchema['fields'],'key'),true),'Employee financial field missing: ' . $financialField);
foreach(['bank_account_holder_name','iban','bank_branch'] as $removedField) importExportAssert(!in_array($removedField,array_column($employeeSchema['fields'],'key'),true),'Removed employee column must not be offered: ' . $removedField);
importExportAssert(ImportExportSchema::VERSION>0,'Workbook version marker must be stable and positive.');

$apiSource=(string)file_get_contents(__DIR__ . '/../src/ImportExportApi.php');
$schemaSource=(string)file_get_contents(__DIR__ . '/../src/ImportExportSchema.php');
$migration=strtolower((string)file_get_contents(__DIR__ . '/../../supabase/migrations/20261118150000_add_import_export_center.sql'));
$fieldAlignmentMigration=strtolower((string)file_get_contents(__DIR__ . '/../../supabase/migrations/20261118160000_align_import_export_employee_fields.sql'));
foreach(['enable row level security','revoke all on public.import_export_jobs','grant select, insert, update, delete on public.import_export_jobs','revoke all on function public.import_export_process_batch(uuid,integer) from public, anon, authenticated','grant execute on function public.import_export_process_batch(uuid,integer) to service_role','for update skip locked','status=\'succeeded\'','where employee_number='] as $contract) importExportAssert(str_contains($migration,$contract),'Missing durable import security/idempotency contract: ' . $contract);
foreach(['pg_get_functiondef','bank_account_holder_name','bank_account_number','iban','bank_branch','employee function still references removed employee columns'] as $contract) importExportAssert(str_contains($fieldAlignmentMigration,$contract),'Missing live-schema alignment contract: ' . $contract);
foreach(['canImportType($actor,$type)','employees.insurance.edit','employees.view','selected_fields','array_diff($keys,array_keys($map))','signedDownloadUrl','purgeExpiredJobs','assertPendingImportPermissions','Cache-Control: no-store','Employee Number was not found.','import_export.view','Insurance\'=>\'insurance'] as $contract) importExportAssert(str_contains($apiSource,$contract),'Missing server-side import/export contract: ' . $contract);
foreach(['employees.financial.edit','employees.documents.view','employees.work.view','employees.insurance.edit','Employee Number'] as $contract) importExportAssert(str_contains($schemaSource,$contract),'Missing field-level permission/schema contract: ' . $contract);
foreach(['result_employee_number','source_reference','row_number','Generated HMS Employee Number'] as $contract) importExportAssert(str_contains((string)file_get_contents(__DIR__ . '/../src/ImportExportApi.php'),$contract),'Missing generated Employee Number result mapping: ' . $contract);

$export=ImportExportWorkbook::export([['key'=>'name','label'=>'Department','type'=>'text'],['key'=>'joining_date','label'=>'Joining date','type'=>'date'],['key'=>'planned_count','label'=>'Headcount','type'=>'integer']], [['name'=>'Synthetic Department','joining_date'=>'2026-01-02','planned_count'=>4]], 'Departments', ['Applied filters'=>'All active records']);
$exportPath=tempnam(sys_get_temp_dir(),'hms-export-test-'); file_put_contents($exportPath,$export); $zip=new ZipArchive(); $zip->open($exportPath);
$workbook=(string)$zip->getFromName('xl/workbook.xml'); $dataSheet=(string)$zip->getFromName('xl/worksheets/sheet2.xml');
importExportAssert(str_contains($workbook,'Summary')&&str_contains($workbook,'Data'),'Export workbook must include summary and data sheets.');
importExportAssert(str_contains($dataSheet,'autoFilter')&&str_contains($dataSheet,'state="frozen"'),'Export table must freeze its header and include filters.');
importExportAssert(str_contains($dataSheet,'s="4" t="n"')&&str_contains($dataSheet,'s="5" t="n"'),'Export dates and numeric values should retain Excel number formats.');
importExportAssert(!str_contains($dataSheet,'<f>'),'Exported user-controlled cells must not contain formulas.');
$zip->close(); @unlink($exportPath);

echo "Import/export contract tests passed\n";
