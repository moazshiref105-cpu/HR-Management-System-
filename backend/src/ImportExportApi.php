<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;
use Throwable;

/** Authenticated, permission-checked API for Excel templates and staged HR data jobs. */
final class ImportExportApi
{
    private ?array $capabilityKeys = null;
    private function __construct(private readonly SupabaseClient $db, private readonly AuthenticatedActorResolver $auth) {}

    public static function fromEnvironment(): self
    {
        $url=rtrim((string)getenv('SUPABASE_URL'),'/'); $key=(string)getenv('SUPABASE_SECRET_KEY');
        if(!filter_var($url,FILTER_VALIDATE_URL)||$key===''||!function_exists('curl_init')) throw new RuntimeException('Server configuration is incomplete.');
        $db=new SupabaseClient($url,$key); return new self($db,AuthenticatedActorResolver::fromEnvironment($db,$url));
    }

    public function dispatch(string $method,string $uri): never
    {
        header('Cache-Control: no-store');
        $parts=explode('/',trim((string)parse_url($uri,PHP_URL_PATH),'/'));
        if(array_slice($parts,0,2)!==['api','import-export']) throw new HttpException('Route not found.',404);
        parse_str((string)parse_url($uri,PHP_URL_QUERY),$query); $actor=$this->auth->resolve(); $this->allow($actor,'import_export.view'); $route=array_slice($parts,2);
        try {
            if($method==='GET'&&$route===['catalog']) $result=$this->catalog($actor);
            elseif($method==='GET'&&$route===['template']) $this->template($query,$actor);
            elseif($method==='GET'&&$route===['imports']) $result=$this->recentJobs($actor);
            elseif($method==='POST'&&$route===['imports']) $result=$this->startImport($actor);
            elseif(count($route)===2&&$route[0]==='imports'&&$method==='GET') $result=$this->job($route[1],$actor);
            elseif(count($route)===3&&$route[0]==='imports'&&$route[2]==='confirm'&&$method==='POST') $result=$this->confirm($route[1],$actor);
            elseif(count($route)===3&&$route[0]==='imports'&&$route[2]==='resume'&&$method==='POST') $result=$this->resume($route[1],$actor);
            elseif(count($route)===3&&$route[0]==='imports'&&$route[2]==='retry'&&$method==='POST') $result=$this->retry($route[1],$actor);
            elseif(count($route)===3&&$route[0]==='imports'&&$route[2]==='report'&&$method==='GET') $this->report($route[1],$actor);
            elseif(count($route)===3&&$route[0]==='exports'&&$route[2]==='download'&&$method==='GET') $result=$this->exportDownload($route[1],$actor);
            elseif($method==='GET'&&$route===['export-preview']) $result=$this->exportPreview($query,$actor);
            elseif($method==='POST'&&$route===['exports']) $result=$this->export($actor);
            else throw new HttpException('Route not found.',404);
        } catch (SupabaseRequestException $exception) {
            if (self::isImportExportMigrationMissing($exception)) {
                throw new HttpException('The Import & Export Center database setup is missing. An administrator must review and apply migration 20261118150000_add_import_export_center.sql to this HMS database before using this feature.', 503, 'IMPORT_EXPORT_SETUP_REQUIRED');
            }
            throw $exception;
        }
        header('Content-Type: application/json; charset=utf-8'); echo json_encode(['data'=>$result],JSON_THROW_ON_ERROR); exit;
    }

    private static function isImportExportMigrationMissing(SupabaseRequestException $exception): bool
    {
        return in_array($exception->databaseCode, ['PGRST202', 'PGRST204', 'PGRST205'], true);
    }

    private function catalog(array $actor): array
    {
        $this->allow($actor,'import_export.view'); $this->purgeExpiredJobs(); $result=[];
        foreach(ImportExportSchema::all() as $key=>$schema) {
            $importGranted=is_string($schema['import']??null)&&$this->can($actor,$schema['import'])&&$this->canImportType($actor,$key);
            $exportGranted=is_string($schema['export']??null)&&$this->can($actor,$schema['export']);
            $importFields=array_values(array_filter($schema['fields'],fn(array $field):bool=>$this->canField($actor,$field,'import')));
            $exportFields=array_values(array_filter($schema['fields'],fn(array $field):bool=>$this->canField($actor,$field,'export')));
            $requiredKeys=array_column(array_filter($schema['fields'],static fn(array $field):bool=>(bool)$field['required']),'key');
            $canImport=$importGranted&&$requiredKeys!==[]&&!array_diff($requiredKeys,array_column($importFields,'key'));
            $canExport=$exportGranted&&$exportFields!==[];
            if(!$canImport&&!$canExport) continue;
            // Keep the two directions separate: some fields (for example source_reference)
            // are valid workbook inputs but must never be offered as export columns.
            $schema['import_fields']=$canImport?$importFields:[];
            $schema['export_fields']=$canExport?$exportFields:[];
            unset($schema['fields']);
            $schema['can_import']=$canImport; $schema['can_export']=$canExport; $schema['version']=ImportExportSchema::VERSION; $result[$key]=$schema;
        }
        return $result;
    }

    private function template(array $query,array $actor): never
    {
        $type=is_string($query['type']??null)?$query['type']:''; $schema=$this->schema($type); if(!is_string($schema['import']??null)) throw new HttpException('This data type is export-only.',422); $this->allow($actor,$schema['import']); if(!$this->canImportType($actor,$type)) throw new HttpException('You are not authorized to import this data type.',403);
        $fields=$this->permittedFields($schema,$actor,'import');
        foreach($schema['fields'] as $field) if($field['required']&&!$this->canField($actor,$field,'import')) throw new HttpException('Your access does not include all required fields for this import type.',403);
        $dropdowns=[];
        foreach(array_unique(array_column(array_filter($fields,static fn(array $field):bool=>($field['type']??'')==='reference'),'table')) as $table) {
            $options=$this->db->service('GET','/rest/v1/' . $table . '?select=name,is_active&order=name&limit=1000');
            $dropdowns[$table]=array_values(array_map(static fn(array $row):string=>(string)$row['name'],array_filter(is_array($options)?$options:[],static fn(array $row):bool=>($row['is_active']??true)===true)));
        }
        $file=ImportExportWorkbook::template(array_merge($schema,['fields'=>$fields]),$type,$dropdowns);
        $this->download('hms_' . $type . '_template_v' . ImportExportSchema::VERSION . '.xlsx',$file);
    }

    private function startImport(array $actor): array
    {
        if(!isset($_FILES['workbook'])||!is_array($_FILES['workbook'])) throw new HttpException('Choose an Excel .xlsx workbook to upload.',422);
        $file=$_FILES['workbook']; $type=is_string($_POST['type']??null)?$_POST['type']:''; $schema=$this->schema($type); if(!is_string($schema['import']??null)) throw new HttpException('This data type cannot be imported.',422); $this->allow($actor,$schema['import']); if(!$this->canImportType($actor,$type)) throw new HttpException('You are not authorized to import this data type.',403);
        if(!is_string($file['name']??null)||!is_string($file['tmp_name']??null)) throw new HttpException('The uploaded workbook metadata is invalid.',422);
        if(($file['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name'])) throw new HttpException('The workbook could not be uploaded. Try again with a file under 2 MB.',422);
        $name=$file['name']; $tmp=$file['tmp_name'];
        if(strtolower(pathinfo($name,PATHINFO_EXTENSION))!=='xlsx'||(int)($file['size']??0)>ImportExportWorkbook::MAX_FILE_BYTES||!str_starts_with((string)file_get_contents($tmp,false,null,0,2),'PK')) throw new HttpException('Only valid Excel .xlsx workbooks up to 2 MB are supported.',422);
        foreach($schema['fields'] as $field) if($field['required']&&!$this->canField($actor,$field,'import')) throw new HttpException('Your access does not include all required fields for this import type.',403);
        $fields=$this->permittedFields($schema,$actor,'import'); $parsed=ImportExportWorkbook::parse($tmp,$type,$fields);
        if($parsed['rows']===[]) throw new HttpException('Add at least one data row before uploading the workbook.',422);
        $normalized=$this->validateRows($type,$parsed['rows'],$fields,$actor);
        $valid=count(array_filter($normalized,static fn(array $row):bool=>$row['issues']===[]));
        $status=$valid===count($normalized)?'ready':'preflight';
        $jobs=$this->db->service('POST','/rest/v1/import_export_jobs',[[
            'direction'=>'import','data_type'=>$type,'actor_id'=>$actor['id'],'template_version'=>$parsed['version'],'status'=>$status,
            'total_rows'=>count($normalized),'valid_rows'=>$valid,'selected_fields'=>array_column($fields,'key'),'source_name'=>'uploaded-xlsx',
        ]],['Prefer: return=representation']);
        $job=$jobs[0]??null; if(!is_array($job)||!is_string($job['id']??null)) throw new RuntimeException('The import job could not be staged.');
        try { foreach(array_chunk($normalized,250) as $chunk) {
                $batch=array_map(static fn(array $row):array=>['job_id'=>$job['id'],'row_number'=>$row['row'],'source_reference'=>$row['source_reference'],'row_data'=>$row['data'],'issues'=>$row['issues'],'status'=>'ready'],$chunk);
                $this->db->service('POST','/rest/v1/import_export_job_rows',$batch);
            }
        } catch(Throwable) {
            try { $this->db->service('PATCH','/rest/v1/import_export_jobs?id=eq.' . rawurlencode($job['id']),['status'=>'failed','outcome'=>['error'=>'staging_incomplete']]); } catch(Throwable) {}
            try { $this->audit($job['id'],$actor,'import',$type,$fields,[],count($normalized),'staging_failed',$parsed['version']); } catch(Throwable) {}
            throw new RuntimeException('The full workbook could not be staged. No employee or Setup records were changed; upload the workbook again.');
        }
        $this->audit($job['id'],$actor,'import',$type,$fields,[],count($normalized),$status,$parsed['version']);
        return ['job_id'=>$job['id'],'status'=>$status,'total_rows'=>count($normalized),'valid_rows'=>$valid,'invalid_rows'=>count($normalized)-$valid,'rows'=>array_map(static fn(array $row):array=>['row'=>$row['row'],'source_reference'=>$row['source_reference'],'issues'=>$row['issues']],array_filter($normalized,static fn(array $row):bool=>$row['issues']!==[]))];
    }

    private function validateRows(string $type,array $rows,array $fields,array $actor): array
    {
        $referenceNames=[]; foreach($fields as $field) if(($field['type']??'')==='reference') $referenceNames[$field['key']]=$field['table'];
        $references=[];
        foreach(array_unique(array_values($referenceNames)) as $table) {
            $rowsByName=$this->db->service('GET','/rest/v1/' . $table . '?select=id,name,is_active&order=name&limit=10000');
            foreach(is_array($rowsByName)?$rowsByName:[] as $item) if(($item['is_active']??true)===true) { $name=mb_strtolower(trim((string)$item['name'])); $references[$table][$name]=array_key_exists($name,$references[$table]??[])?null:(int)$item['id']; }
        }
        $employeeNumbers=[]; $identityNumbers=[];
        foreach($rows as $row) { $data=$row['data']; if(is_numeric($data['employee_number']??null)) $employeeNumbers[(string)$data['employee_number']]=true; if(is_string($data['identity_card_number']??null)&&$data['identity_card_number']!=='') $identityNumbers[$data['identity_card_number']]=true; }
        $knownEmployees=[]; $existingIdentityNumbers=[];
        foreach(array_chunk(array_keys($employeeNumbers),100) as $chunk) {
            $numbers=implode(',',array_map('rawurlencode',$chunk));
            $found=$this->db->service('GET','/rest/v1/employees?select=employee_number,identity_card_number,updated_at&employee_number=in.(' . $numbers . ')&limit=200');
            foreach(is_array($found)?$found:[] as $employee) { $knownEmployees[(string)$employee['employee_number']]=$employee; if(isset($employee['identity_card_number'])) $existingIdentityNumbers[(string)$employee['identity_card_number']]=(string)$employee['employee_number']; }
        }
        foreach(array_chunk(array_keys($identityNumbers),100) as $chunk) {
            $numbers=implode(',',array_map(static fn(string $id):string=>rawurlencode('"' . $id . '"'),$chunk));
            $found=$this->db->service('GET','/rest/v1/employees?select=employee_number,identity_card_number,updated_at&identity_card_number=in.(' . $numbers . ')&limit=200');
            foreach(is_array($found)?$found:[] as $employee) { $existingIdentityNumbers[(string)$employee['identity_card_number']]=(string)$employee['employee_number']; $knownEmployees[(string)$employee['employee_number']]=$employee; }
        }
        $spouseNameCounts=[];
        if($type==='children') foreach(array_chunk(array_keys($employeeNumbers),100) as $chunk) {
            $numbers=implode(',',array_map('rawurlencode',$chunk));
            $wives=$this->db->service('GET','/rest/v1/employee_wives?select=wife_name,employee:employees!inner(employee_number)&employee.employee_number=in.(' . $numbers . ')&limit=10000');
            foreach(is_array($wives)?$wives:[] as $wife) { $number=(string)($wife['employee']['employee_number']??''); $name=mb_strtolower(trim((string)($wife['wife_name']??''))); if($number!==''&&$name!=='') $spouseNameCounts[$number][$name]=($spouseNameCounts[$number][$name]??0)+1; }
        }
        $positionCodes=[];
        if($type==='setup_positions') { $positions=$this->db->service('GET','/rest/v1/positions?select=name,position_code&limit=10000'); foreach(is_array($positions)?$positions:[] as $position) $positionCodes[mb_strtolower(trim((string)$position['position_code']))]=mb_strtolower(trim((string)$position['name'])); }
        $seen=[]; $seenNewEmployeeIds=[]; $out=[];
        foreach($rows as $row) {
            $data=$row['data']; $issues=[]; $source=trim((string)($data['source_reference']??''));
            if($type==='employees'&&empty($data['employee_number'])&&!$this->can($actor,'employees.create')) $issues[]=['field'=>'employee_number','message'=>'Creating employees requires employees.create permission.'];
            if($type==='employees'&&!empty($data['employee_number'])&&!$this->can($actor,'employees.edit')) $issues[]=['field'=>'employee_number','message'=>'Updating employees requires employees.edit permission.'];
            foreach($fields as $field) {
                $value=$data[$field['key']]??null;
                $updatingEmployee=$type==='employees'&&is_numeric($data['employee_number']??null);
                if($value===null) { if($field['required']&&!$updatingEmployee) $issues[]=['field'=>$field['key'],'message'=>$field['label'] . ' is required.']; continue; }
                if(!$this->canField($actor,$field,'import')) { $issues[]=['field'=>$field['key'],'message'=>'You do not have permission to import this field.']; continue; }
                $error=$this->validateValue($value,$field);
                if($error!==null) { $issues[]=['field'=>$field['key'],'message'=>$error]; continue; }
                if(($field['type']??'')==='reference') {
                    $id=$references[$field['table']][mb_strtolower(trim((string)$value))]??null;
                    if($id===null) { $issues[]=['field'=>$field['key'],'message'=>'Choose an exact active ' . $field['label'] . ' name.']; continue; }
                    $idField=substr($field['key'],0,-5) . '_id';
                    if(!str_ends_with($field['key'],'_name')) $idField=$field['key'] . '_id';
                    $data[$idField]=$id;
                }
            }
            if(isset($data['employee_number'])&&$data['employee_number']!==null) {
                if(!isset($knownEmployees[(string)$data['employee_number']])&&$type==='employees') $issues[]=['field'=>'employee_number','message'=>'This Employee Number does not exist. New employees leave this field blank.'];
                if($type!=='employees'&&!isset($knownEmployees[(string)$data['employee_number']])) $issues[]=['field'=>'employee_number','message'=>'This Employee Number does not match an existing HMS employee.'];
                if($type==='employees'&&isset($knownEmployees[(string)$data['employee_number']])) $data['expected_updated_at']=$knownEmployees[(string)$data['employee_number']]['updated_at']??null;
                if($type==='employees'&&isset($knownEmployees[(string)$data['employee_number']])&&isset($data['identity_card_number'])&&$data['identity_card_number']!==$knownEmployees[(string)$data['employee_number']]['identity_card_number']&&isset($existingIdentityNumbers[(string)$data['identity_card_number']])) $issues[]=['field'=>'identity_card_number','message'=>'This National ID belongs to a different existing employee. Use that employee’s Employee Number to update it.'];
            } elseif($type==='employees'&&isset($data['identity_card_number'])&&isset($existingIdentityNumbers[(string)$data['identity_card_number']])) {
                $issues[]=['field'=>'identity_card_number','message'=>'This National ID already belongs to an HMS employee. Fill that employee’s Employee Number to update the existing record.'];
            }
            if($type==='employees'&&empty($data['employee_number'])&&!empty($data['identity_card_number'])) {
                $identity=(string)$data['identity_card_number'];
                if(isset($seenNewEmployeeIds[$identity])) $issues[]=['field'=>'identity_card_number','message'=>'This National ID is also used by input row ' . $seenNewEmployeeIds[$identity] . '. Each new employee needs a unique National ID.'];
                else $seenNewEmployeeIds[$identity]=$row['row'];
            }
            if($type==='employees'&&empty($data['employee_number'])&&($data['employee_status']??'active')!=='active') $issues[]=['field'=>'employee_status','message'=>'New employee rows must start as active. Use the employee lifecycle workflow for resignations.'];
            if($type==='employees'&&($data['employee_status']??'')==='resigned'&&!$this->can($actor,'employees.delete')) $issues[]=['field'=>'employee_status','message'=>'Resignation imports require employees.delete permission.'];
            if($type==='children'&&!empty($data['wife_name'])) {
                $matches=$spouseNameCounts[(string)$data['employee_number']][mb_strtolower(trim((string)$data['wife_name']))]??0;
                if($matches!==1) $issues[]=['field'=>'wife_name','message'=>$matches===0?'No spouse matches that name for this employee.':'More than one spouse matches that name; leave the optional spouse name blank or resolve the duplicate first.'];
            }
            if($type==='licenses'&&isset($data['release_date'],$data['expiry_date'])&&$data['expiry_date']<$data['release_date']) $issues[]=['field'=>'expiry_date','message'=>'Expiry date must be on or after release date.'];
            if($type==='employees'&&isset($data['joining_date'],$data['contract_signing_date'])&&$data['contract_signing_date']<$data['joining_date']) $issues[]=['field'=>'contract_signing_date','message'=>'Contract signing date must be on or after joining date.'];
            if($type==='employees'&&isset($data['employee_status'])&&$data['employee_status']==='resigned'&&(empty($data['leaving_date'])||empty($data['leaving_reason_id']))) $issues[]=['field'=>'leaving_date','message'=>'A resignation needs a leaving date and an active leaving reason.'];
            $natural=$this->naturalKey($type,$data);
            if($natural!==null&&isset($seen[$natural])) $issues[]=['field'=>'row','message'=>'Duplicates row ' . $seen[$natural] . ' using this data type’s matching rule.'];
            elseif($natural!==null) $seen[$natural]=$row['row'];
            if($source!==''&&isset($seen['source:' . $source])) $issues[]=['field'=>'source_reference','message'=>'Source reference duplicates row ' . $seen['source:' . $source] . '.']; elseif($source!=='') $seen['source:' . $source]=$row['row'];
            if($type==='employees'&&empty($data['employee_number'])&&$source==='') $issues[]=['field'=>'source_reference','message'=>'Add a source reference so the generated Employee Number can be matched back to this input row.'];
            if($type==='setup_positions'&&!empty($data['position_code'])) {
                $code=mb_strtolower(trim((string)$data['position_code'])); $name=mb_strtolower(trim((string)($data['name']??'')));
                if(isset($seen['position-code:' . $code])) $issues[]=['field'=>'position_code','message'=>'Position code duplicates input row ' . $seen['position-code:' . $code] . '.'];
                else $seen['position-code:' . $code]=$row['row'];
                if(isset($positionCodes[$code])&&$positionCodes[$code]!==$name) $issues[]=['field'=>'position_code','message'=>'This position code already belongs to a different Setup position.'];
            }
            $out[]=['row'=>$row['row'],'source_reference'=>$source===''?null:$source,'data'=>$data,'issues'=>$issues];
        }
        return $out;
    }

    private function validateValue(mixed $value,array $field): ?string
    {
        $error=match($field['type']) {
            'text','reference'=>!is_scalar($value)||mb_strlen((string)$value)>10000?'Enter text no longer than 10,000 characters.':null,
            'integer'=>!is_numeric($value)||(float)$value!=(int)$value||abs((int)$value)>($field['key']==='employee_number'?9007199254740991:2147483647)||($field['key']==='employee_number'&&(int)$value<1)||($field['key']==='planned_count'&&(int)$value<0)?'Enter a valid whole number.':null,
            'decimal'=>!is_numeric($value)||(float)$value<0?'Enter a non-negative number.':null,
            'date'=>!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value)||!checkdate((int)substr($value,5,2),(int)substr($value,8,2),(int)substr($value,0,4))?'Enter a valid date as YYYY-MM-DD.':(($field['key']==='date_of_birth'&&$value>(new \DateTimeImmutable('today',new \DateTimeZone('Africa/Cairo')))->format('Y-m-d'))?'Date of birth cannot be in the future.':null),
            'boolean'=>!in_array(strtolower((string)$value),['true','false','1','0','yes','no'],true)?'Enter TRUE or FALSE.':null,
            'enum'=>!in_array((string)$value,$field['values']??[],true)?'Choose one of the listed values.':null,
            default=>'This field type is not supported.',
        };
        if($error!==null) return $error;
        if($field['key']==='identity_card_number'&&(!is_string($value)||!preg_match('/^\d{14}$/',$value))) return 'Enter exactly 14 digits.';
        if($field['key']==='phone'&&(!is_string($value)||!preg_match('/^\d{11}$/',$value))) return 'Enter exactly 11 digits.';
        return null;
    }

    private function naturalKey(string $type,array $data): ?string
    {
        $keys=match($type) { 'spouses'=>['employee_number','identity_card_number'],'children'=>['employee_number','identity_card_number'],'licenses'=>['employee_number','license_type_id','release_date','expiry_date'],'social_insurance'=>['employee_number'],'hiring_plans'=>['project_id','department_id','position_id'],'employees'=>['employee_number'],default=>[] };
        if($keys===[]) return null; foreach($keys as $key) if(($data[$key]??null)===null) return null;
        return $type . ':' . implode('|',array_map(static fn(string $key):string=>(string)$data[$key],$keys));
    }

    private function confirm(string $id,array $actor): array
    {
        $job=$this->ownedJob($id,$actor,'import');
        $this->assertPendingImportPermissions($job,$actor);
        if(($job['status']??'')!=='ready'||(int)$job['valid_rows']!==(int)$job['total_rows']) throw new HttpException('Resolve every row issue and upload a corrected workbook before confirming.',422);
        $this->db->service('PATCH','/rest/v1/import_export_jobs?id=eq.' . rawurlencode($id),['confirmed_by'=>$actor['id'],'confirmed_at'=>gmdate('c'),'status'=>'processing']);
        $this->audit($id,$actor,'import',(string)$job['data_type'],$this->permittedFields($this->schema((string)$job['data_type']),$actor,'import'),[],(int)$job['total_rows'],'confirmed',(int)$job['template_version']);
        return $this->resume($id,$actor);
    }

    private function resume(string $id,array $actor): array
    {
        $job=$this->ownedJob($id,$actor,'import'); $this->assertPendingImportPermissions($job,$actor);
        $result=$this->db->service('POST','/rest/v1/rpc/import_export_process_batch',['p_job_id'=>$id,'p_limit'=>25]);
        $job=$this->db->service('GET','/rest/v1/import_export_jobs?select=id,status,total_rows,valid_rows,successful_rows,failed_rows,confirmed_at,completed_at,expires_at&id=eq.' . rawurlencode($id) . '&limit=1');
        return ['job'=>$job[0]??[],'batch'=>$result];
    }

    /** Requeue only rows whose transaction failed; successful rows remain immutable for safe retries. */
    private function retry(string $id,array $actor): array
    {
        $job=$this->ownedJob($id,$actor,'import'); $this->assertPendingImportPermissions($job,$actor);
        if(($job['status']??'')!=='completed_with_errors') throw new HttpException('Only a completed import with database row failures can be retried.',422);
        $this->db->service('PATCH','/rest/v1/import_export_job_rows?job_id=eq.' . rawurlencode($id) . '&status=eq.failed',['status'=>'ready','error_code'=>null,'completed_at'=>null]);
        $this->db->service('PATCH','/rest/v1/import_export_jobs?id=eq.' . rawurlencode($id),['status'=>'processing','failed_rows'=>0,'completed_at'=>null]);
        return $this->resume($id,$actor);
    }

    private function job(string $id,array $actor): array
    {
        $this->uuid($id); $job=$this->db->service('GET','/rest/v1/import_export_jobs?select=id,direction,data_type,status,total_rows,valid_rows,successful_rows,failed_rows,started_at,confirmed_at,completed_at,expires_at,outcome&id=eq.' . rawurlencode($id) . '&actor_id=eq.' . rawurlencode($actor['id']) . '&limit=1');
        if(!isset($job[0])) throw new HttpException('Job was not found.',404);
        $errors=$this->db->service('GET','/rest/v1/import_export_job_rows?select=row_number,source_reference,issues,status,error_code,result_employee_number&job_id=eq.' . rawurlencode($id) . '&or=(issues.neq.%5B%5D,status.eq.failed)&order=row_number&limit=1000');
        return ['job'=>$job[0],'rows'=>array_map(static function(array $row):array { $row['error_message']=self::humanError((string)($row['error_code']??'')); return $row; },is_array($errors)?$errors:[])];
    }

    private function recentJobs(array $actor): array
    {
        $this->allow($actor,'import_export.view');
        $this->purgeExpiredJobs();
        return $this->db->service('GET','/rest/v1/import_export_jobs?select=id,direction,data_type,status,total_rows,valid_rows,successful_rows,failed_rows,started_at,completed_at,expires_at,outcome&actor_id=eq.' . rawurlencode($actor['id']) . '&order=started_at.desc&limit=20');
    }

    /** Purge expired job rows and private export objects opportunistically; no file contents are logged. */
    private function purgeExpiredJobs(): void
    {
        $expired=$this->db->service('GET','/rest/v1/import_export_jobs?select=id,outcome&expires_at=lt.' . rawurlencode(gmdate('c')) . '&limit=50');
        if(!is_array($expired)||$expired===[]) return;
        $paths=[];
        foreach($expired as $job) {
            $path=$job['outcome']['storage_path']??null;
            if(is_string($path)&&preg_match('/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.xlsx$/i',$path)) $paths[]=$path;
        }
        if($paths!==[]) $this->db->service('DELETE','/storage/v1/object/import-export',['prefixes'=>$paths]);
        $ids=array_map(static fn(array $job):string=>(string)$job['id'],$expired);
        $this->db->service('DELETE','/rest/v1/import_export_jobs?id=in.(' . implode(',',array_map('rawurlencode',$ids)) . ')');
    }

    private function report(string $id,array $actor): never
    {
        $job=$this->ownedJob($id,$actor,'import');
        $rows=$this->db->service('GET','/rest/v1/import_export_job_rows?select=row_number,source_reference,status,error_code,result_employee_number,issues&job_id=eq.' . rawurlencode($id) . '&order=row_number&limit=20000');
        $fields=[['key'=>'source_reference','label'=>'Source reference'],['key'=>'row_number','label'=>'Input row'],['key'=>'status','label'=>'Result'],['key'=>'result_employee_number','label'=>'Generated HMS Employee Number'],['key'=>'error_code','label'=>'Issue code'],['key'=>'issues','label'=>'Validation details']];
        $data=array_map(static fn(array $row):array=>['source_reference'=>$row['source_reference']??'','row_number'=>$row['row_number']??'','status'=>$row['status']??'','result_employee_number'=>$row['result_employee_number']??'','error_code'=>self::humanError($row['error_code']??''),'issues'=>implode('; ',array_map(static fn($issue)=>$issue['message']??'',$row['issues']??[]))],is_array($rows)?$rows:[]);
        $this->download('hms_' . $job['data_type'] . '_import_result.xlsx',ImportExportWorkbook::export($fields,$data,'Import result · ' . $job['data_type'],['Job ID'=>$id,'Status'=>$job['status'],'Rows'=>$job['total_rows']]));
    }

    private function exportPreview(array $query,array $actor): array
    {
        $type=is_string($query['type']??null)?$query['type']:''; $schema=$this->schema($type); $this->allow($actor,$schema['export']);
        if(isset($query['fields'])&&!is_string($query['fields'])) throw new HttpException('Choose export columns using valid field names.',422);
        $fields=$this->permittedFields($schema,$actor,'export'); $selected=$this->selectedFields($query['fields']??'', $fields);
        $filters=$this->exportFilters($query,$type); $rows=$this->exportRows($type,$selected,$filters,1,1);
        return ['type'=>$type,'filters'=>$filters,'fields'=>$selected,'row_count'=>(int)($rows['total']??0),'scope'=>'All records matching these filters'];
    }

    private function export(array $actor): array
    {
        $body=$this->body(); $type=is_string($body['type']??null)?$body['type']:''; $schema=$this->schema($type); $this->allow($actor,$schema['export']);
        $fieldKeys=$body['fields']??[]; if(!is_array($fieldKeys)||array_filter($fieldKeys,static fn(mixed $key):bool=>!is_string($key))!==[]) throw new HttpException('Choose export columns using valid field names.',422);
        $filterInput=$body['filters']??[]; if(!is_array($filterInput)) throw new HttpException('Export filters are invalid.',422);
        $fields=$this->permittedFields($schema,$actor,'export'); $selected=$this->selectedFields(implode(',', $fieldKeys), $fields); $filters=$this->exportFilters($filterInput,$type);
        $result=$this->exportRows($type,$selected,$filters,1,10000); if((int)$result['total']>10000) throw new HttpException('This export exceeds the current 10,000-row workbook limit. Narrow the filters and create separate workbooks.',422,'export_row_limit'); $rows=$result['rows']??[];
        $safeRows=array_map(static function(array $row) use ($selected):array { $out=[]; foreach($selected as $field) $out[$field['key']]=$row[$field['key']]??''; return $out; },$rows);
        $file=ImportExportWorkbook::export($selected,$safeRows,$schema['title'],$filters);
        $jobRows=$this->db->service('POST','/rest/v1/import_export_jobs',[[
            'direction'=>'export','data_type'=>$type,'actor_id'=>$actor['id'],'template_version'=>ImportExportSchema::VERSION,'status'=>'processing','total_rows'=>(int)$result['total'],'valid_rows'=>(int)$result['total'],'filters'=>$filters,'selected_fields'=>array_column($selected,'key'),'source_name'=>'HMS export workbook','expires_at'=>gmdate('c',time()+86400),
        ]],['Prefer: return=representation']);
        $job=$jobRows[0]??null; if(!is_array($job)||!is_string($job['id']??null)) throw new RuntimeException('The export job could not be recorded.');
        $storagePath=$actor['id'] . '/' . $job['id'] . '.xlsx';
        $uploaded=false;
        try {
            $this->db->serviceBinary('/storage/v1/object/import-export/' . $storagePath,$file,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            $uploaded=true;
            $outcome=['storage_path'=>$storagePath,'file_name'=>'hms_' . $type . '_export.xlsx'];
            $this->db->service('PATCH','/rest/v1/import_export_jobs?id=eq.' . rawurlencode($job['id']),['status'=>'completed','successful_rows'=>count($safeRows),'completed_at'=>gmdate('c'),'outcome'=>$outcome]);
            $this->audit($job['id'],$actor,'export',$type,$selected,$filters,count($safeRows),'completed',ImportExportSchema::VERSION);
            return ['job_id'=>$job['id'],'file_name'=>$outcome['file_name'],'row_count'=>count($safeRows),'total_rows'=>(int)$result['total'],'download_url'=>$this->signedDownloadUrl($storagePath,$outcome['file_name']),'expires_at'=>$job['expires_at']];
        } catch(Throwable $exception) {
            if($uploaded) { try { $this->db->service('DELETE','/storage/v1/object/import-export/' . $storagePath); } catch(Throwable) {} }
            try { $this->db->service('PATCH','/rest/v1/import_export_jobs?id=eq.' . rawurlencode($job['id']),['status'=>'failed','completed_at'=>gmdate('c'),'outcome'=>['error'=>'workbook_generation_failed']]); } catch(Throwable) {}
            throw $exception;
        }
    }

    private function exportDownload(string $id,array $actor): array
    {
        $job=$this->ownedJob($id,$actor,'export');
        if(($job['status']??'')!=='completed'||!is_string($job['outcome']['storage_path']??null)||strtotime((string)$job['expires_at'])<time()) throw new HttpException('The private export has expired. Create a fresh workbook.',410,'export_expired');
        return ['download_url'=>$this->signedDownloadUrl($job['outcome']['storage_path'],$job['outcome']['file_name']??'hms_export.xlsx'),'file_name'=>$job['outcome']['file_name']??'hms_export.xlsx','expires_in_seconds'=>300];
    }

    private function signedDownloadUrl(string $path,string $fileName): string
    {
        if(!preg_match('/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.xlsx$/i',$path)) throw new RuntimeException('Private export path is invalid.');
        $result=$this->db->service('POST','/storage/v1/object/sign/import-export/' . $path,['expiresIn'=>300]);
        $url=is_array($result)?($result['signedURL']??null):null;
        if(!is_string($url)||!str_starts_with($url,'/object/sign/import-export/')) throw new RuntimeException('Unable to create a short-lived private download link.');
        $separator=str_contains($url,'?')?'&':'?';
        return rtrim((string)getenv('SUPABASE_URL'),'/') . '/storage/v1' . $url . $separator . 'download=' . rawurlencode(basename($fileName));
    }

    private function exportRows(string $type,array $fields,array $filters,int $page,int $pageSize): array
    {
        [$table,$select,$filterMap]=$this->exportConfig($type,$fields); $clauses=[];
        foreach($filters as $key=>$value) if(isset($filterMap[$key])&&$value!=='') $clauses[]=$filterMap[$key] . '=eq.' . rawurlencode((string)$value);
        $base='/rest/v1/' . $table . '?select=' . rawurlencode($select) . ($clauses?'&'.implode('&',$clauses):'') . '&order=created_at.desc,id.asc';
        $chunkSize=min(max(1,$pageSize),1000); $offset=($page-1)*$pageSize;
        $first=$this->db->serviceWithExactCount('GET',$base . '&offset=' . $offset . '&limit=' . $chunkSize); $total=(int)$first['total']; $rows=is_array($first['data']??null)?$first['data']:[];
        if($pageSize<=1000||$total>$pageSize) return ['rows'=>$this->flattenRows($type,$rows),'total'=>$total];
        for($nextOffset=$offset+count($rows);$nextOffset<$offset+$pageSize&&$nextOffset<$offset+$total;) {
            $response=$this->db->serviceWithExactCount('GET',$base . '&offset=' . $nextOffset . '&limit=' . min(1000,$offset+$pageSize-$nextOffset));
            $batch=is_array($response['data']??null)?$response['data']:[]; if($batch===[]) break; $rows=array_merge($rows,$batch); $nextOffset+=count($batch);
        }
        if(count($rows)!==$total) throw new HttpException('Records changed while the workbook was being prepared. Preview again and retry the export.',409,'export_snapshot_changed');
        return ['rows'=>$this->flattenRows($type,$rows),'total'=>$total];
    }

    private function exportConfig(string $type,array $fields): array
    {
        $base=match($type) {
            'employees'=>['employees',[],['employee_number'=>'employee_number','employee_status'=>'employee_status','department_id'=>'department_id','project_id'=>'project_id']],
            'spouses'=>['employee_wives',['employee:employees!inner(employee_number)'],['employee_number'=>'employee.employee_number']],
            'children'=>['employee_children',['employee:employees!inner(employee_number)','wife:employee_wives(wife_name)'],['employee_number'=>'employee.employee_number']],
            'licenses'=>['employee_licenses',['employee:employees!inner(employee_number)','license_type:license_types(name)'],['employee_number'=>'employee.employee_number']],
            'social_insurance'=>['employee_social_insurance',['employee:employees!inner(employee_number)'],['employee_number'=>'employee.employee_number']],
            'hiring_plans'=>['project_hiring_plans',['project:projects(name)','department:departments(name)','position:positions(name)'],['project_id'=>'project_id','department_id'=>'department_id']],
            'documents'=>['employee_documents',['employee:employees!inner(employee_number)','document_type:employee_document_types(name)'],['employee_number'=>'employee.employee_number']],
            'contract_renewals'=>['employee_contract_renewals',['employee:employees!inner(employee_number)'],['employee_number'=>'employee.employee_number']],
            default=>str_starts_with($type,'setup_')?[$this->schema($type)['table'],[],[]]:throw new HttpException('Export for this data type is not available.',422),
        };
        [$table,$joins,$filtersMap]=$base;
        $columns=[];
        foreach($fields as $field) {
            $key=$field['key'];
            if($key==='employee_number') { $columns[]='employee_number'; continue; }
            $relation=match($key) { 'religion_name'=>'religion:religions(name)','marital_status_name'=>'marital_status:marital_statuses(name)','diploma_name'=>'diploma:diplomas(name)','governorate_name'=>'governorate:governorates(name)','department_name'=>'department:departments(name)','shift_type_name'=>'shift_type:shift_types(name)','team_name'=>'team:teams(name)','position_name'=>'position:positions(name)','project_name'=>'project:projects(name)','bank_name'=>'bank:banks(name)','leaving_reason_name'=>'leaving_reason:leaving_reasons(name)','license_type_name'=>'license_type:license_types(name)','document_type_name'=>'document_type:employee_document_types(name)','wife_name'=>'wife:employee_wives(wife_name)',default=>null};
            if($relation!==null) { $columns[]=$relation; continue; }
            if($key==='source_reference') continue;
            $columns[]=$key;
        }
        foreach($joins as $join) $columns[]=$join;
        $select=implode(',',array_values(array_unique($columns)));
        return [$table,$select,$filtersMap];
    }

    private function flattenRows(string $type,array $rows): array
    {
        foreach($rows as &$row) { if(!is_array($row)) continue; $row['employee_number']=$row['employee']['employee_number']??$row['employee_number']??''; foreach(['religion','marital_status','diploma','governorate','department','shift_type','team','position','project','bank','leaving_reason','license_type','document_type'] as $relation) { $row[$relation . '_name']=$row[$relation]['name']??$row[$relation]['wife_name']??''; } $row['wife_name']=$row['wife']['wife_name']??$row['wife_name']??''; unset($row['employee'],$row['license_type'],$row['wife'],$row['project'],$row['department'],$row['position'],$row['religion'],$row['marital_status'],$row['diploma'],$row['governorate'],$row['shift_type'],$row['team'],$row['bank'],$row['leaving_reason'],$row['document_type']); }
        unset($row); return $rows;
    }

    private function exportFilters(array $source,string $type): array
    {
        $allowed=match($type) {'employees'=>['employee_number','employee_status','department_id','project_id'],'hiring_plans'=>['department_id','project_id'], 'spouses','children','licenses','social_insurance','documents','contract_renewals'=>['employee_number'], default=>[]}; $out=[];
        foreach($allowed as $key) if(isset($source[$key])&&$source[$key]!=='') {
            $value=$source[$key]; if(!is_scalar($value)) throw new HttpException('An export filter is invalid.',422); $text=(string)$value;
            if($key==='employee_status'?!in_array($text,['active','resigned'],true):!preg_match('/^[1-9]\d{0,18}$/',$text)) throw new HttpException('An export filter is invalid.',422);
            $out[$key]=$value;
        }
        return $out;
    }

    private function selectedFields(string $raw,array $allowed): array
    {
        $keys=array_values(array_unique(array_filter(array_map('trim',explode(',',$raw))))); if($keys===[]) $keys=array_column($allowed,'key');
        $map=[]; foreach($allowed as $field) $map[$field['key']]=$field;
        if(array_diff($keys,array_keys($map))) throw new HttpException('The export includes a field you are not permitted to access.',403);
        return array_map(static fn(string $key):array=>$map[$key],$keys);
    }

    private function flattenSelected(array $row,array $selected): array { $out=[]; foreach($selected as $field) $out[$field['key']]=$row[$field['key']]??''; return $out; }

    private function ownedJob(string $id,array $actor,string $direction): array
    {
        $this->uuid($id); $rows=$this->db->service('GET','/rest/v1/import_export_jobs?select=*&id=eq.' . rawurlencode($id) . '&actor_id=eq.' . rawurlencode($actor['id']) . '&direction=eq.' . $direction . '&limit=1');
        if(!isset($rows[0])) throw new HttpException('Job was not found.',404); $job=$rows[0]; $schema=$this->schema((string)$job['data_type']); $permission=$schema[$direction]??null; if(!is_string($permission)) throw new HttpException('This job is not available.',403); $this->allow($actor,$permission); if($direction==='import'&&!$this->canImportType($actor,(string)$job['data_type'])) throw new HttpException('Your import access has changed.',403);
        $allowed=array_column($this->permittedFields($schema,$actor,$direction),'key'); if(array_diff($job['selected_fields']??[],$allowed)) throw new HttpException('Your access to one or more fields has changed.',403);
        return $job;
    }

    private function assertPendingImportPermissions(array $job,array $actor): void
    {
        if($job['data_type']!=='employees') return;
        $rows=$this->db->service('GET','/rest/v1/import_export_job_rows?select=row_data&job_id=eq.' . rawurlencode((string)$job['id']) . '&status=in.(ready,failed)&limit=20000');
        foreach(is_array($rows)?$rows:[] as $row) {
            $data=$row['row_data']??[];
            if(empty($data['employee_number'])&&!$this->can($actor,'employees.create')) throw new HttpException('Creating employees requires employees.create permission.',403);
            if(!empty($data['employee_number'])&&!$this->can($actor,'employees.edit')) throw new HttpException('Updating employees requires employees.edit permission.',403);
            if(($data['employee_status']??'')==='resigned'&&!$this->can($actor,'employees.delete')) throw new HttpException('Lifecycle imports require employees.delete permission.',403);
        }
    }

    private function audit(?string $jobId,array $actor,string $direction,string $type,array $fields,array $filters,int $count,string $outcome,int $version): void
    {
        $this->db->service('POST','/rest/v1/import_export_audit',[[
            'job_id'=>$jobId,'actor_id'=>$actor['id'],'direction'=>$direction,'data_type'=>$type,'template_version'=>$version,'fields'=>array_column($fields,'key'),'filters'=>$filters,'row_count'=>$count,'outcome'=>$outcome,
        ]]);
    }

    private function schema(string $type): array { try{return ImportExportSchema::get($type);}catch(\InvalidArgumentException){throw new HttpException('Choose a supported data type.',422);} }
    private function permittedFields(array $schema,array $actor,string $direction): array { return array_values(array_filter($schema['fields'],fn(array $field):bool=>$this->canField($actor,$field,$direction))); }
    private function canField(array $actor,array $field,string $direction): bool
    {
        if ($direction === 'import' && ($field['export_only'] ?? false) === true) return false;
        if($direction==='export'&&($field['key']??'')==='source_reference') return false;
        $section=(string)($field['section']??''); $permission=$field['permission']??null;
        if($permission==='employees.view') return $this->can($actor,'employees.view');
        if(is_string($permission)) {
            if(str_ends_with($permission,'.view')||str_ends_with($permission,'.edit')) { $base=substr($permission,0,strrpos($permission,'.')); $permission=$base . ($direction==='export'?'.view':'.edit'); }
        } else $permission='employees.' . match($section) {'Personal'=>'personal','Employment'=>'personal','Work'=>'work','Financial'=>'financial','Insurance'=>'insurance','Lifecycle'=>'work','Employee link'=>'personal','Record tracking'=>'personal',default=>'personal'} . ($direction==='export'?'.view':'.edit');
        if($permission==='hiring_plans.view') return $this->can($actor,$direction==='import'?'hiring_plans.edit':'hiring_plans.view')||($direction==='export'&&$this->can($actor,'hiring_staffing.view'));
        return $this->can($actor,$permission);
    }
    private function canImportType(array $actor,string $type): bool { return match(true) { $type==='employees'=>$this->can($actor,'employees.create')||$this->can($actor,'employees.edit'), in_array($type,['spouses','children'],true)=>$this->can($actor,'employees.personal.edit'), in_array($type,['licenses','social_insurance'],true)=>$this->can($actor,'employees.insurance.edit'), $type==='hiring_plans'=>$this->can($actor,'hiring_plans.edit'), str_starts_with($type,'setup_')=>$this->can($actor,'setup.edit'), default=>false }; }
    private function can(array $actor,string $permission): bool
    {
        if(($actor['is_super_admin']??false)===true) return true;
        if($this->capabilityKeys===null) {
            $rows=$this->db->service('POST','/rest/v1/rpc/get_user_capabilities',['p_user_id'=>$actor['id']]);
            if(!is_array($rows)) throw new RuntimeException('The permission check could not be completed.');
            $this->capabilityKeys=[];
            foreach($rows as $row) if(is_array($row)&&is_string($row['permission_key']??null)) $this->capabilityKeys[$row['permission_key']]=true;
        }
        return isset($this->capabilityKeys[$permission]);
    }
    private function allow(array $actor,string $permission): void { if(!$this->can($actor,$permission)) throw new HttpException('You are not authorized for this action.',403); }
    private function uuid(string $id): void { if(!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$id)) throw new HttpException('Job ID is invalid.',422); }
    private function body(): array { $raw=file_get_contents('php://input'); if(!$raw)return []; try{$data=json_decode($raw,true,512,JSON_THROW_ON_ERROR);}catch(\JsonException){throw new HttpException('Request body is not valid JSON.',400);} if(!is_array($data))throw new HttpException('JSON object expected.',400); return $data; }
    private function download(string $name,string $data): never { header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); header('Content-Disposition: attachment; filename="' . rawurlencode($name) . '"'); header('Content-Length: ' . strlen($data)); echo $data; exit; }
    private static function humanError(string $code): string { return match($code) {'HMS_EMPLOYEE_NUMBER_NOT_FOUND'=>'Employee Number was not found.','HMS_LICENSE_MATCH_AMBIGUOUS'=>'More than one matching license exists; review the employee record.','HMS_CHILD_SPOUSE_NOT_FOUND'=>'The selected spouse could not be matched to this employee.','HMS_CHILD_SPOUSE_AMBIGUOUS'=>'More than one spouse has that name; review the employee record.','HMS_EMPLOYEE_CHANGED_REVIEW'=>'The employee changed after preflight. Upload a fresh workbook to review the current record.','HMS_LIFECYCLE_IMPORT_INVALID'=>'A resignation needs valid leaving details.','HMS_RESIGNED_EMPLOYEE_REACTIVATION_BLOCKED'=>'Use the employee lifecycle workflow to review a resigned employee.','HMS_SETUP_NAME_AMBIGUOUS'=>'More than one Setup item has this name; resolve the duplicate first.','HMS_DOCUMENT_IMPORT_REQUIRES_ATTACHMENT_WORKFLOW'=>'Document imports require a separate private attachment workflow.','HMS_IMPORT_TYPE_UNSUPPORTED'=>'This data type cannot be imported yet.','HMS_ROW_WRITE_FAILED'=>'This row did not meet a database rule. Review the row and retry.',''=>'No database error details are available.','default'=>'This row could not be saved. Review the data and retry.'}; }
}
