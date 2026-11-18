<?php

declare(strict_types=1);

namespace Hms\Backend;

/** One server-owned contract drives workbook columns, validation, permissions, and exports. */
final class ImportExportSchema
{
    public const VERSION = 1;

    /** @return array<string,array<string,mixed>> */
    public static function all(): array
    {
        $schemas = [
            'employees' => ['module'=>'Employees','title'=>'Employee records','import'=>'import_export.employees.import','export'=>'import_export.employees.export','fields'=>[
                self::f('source_reference','Source reference','text',false,'Record tracking','import_export.employees.import'),
                self::f('employee_number','Employee Number','integer',false,'Identification','employees.view','Existing Employee Number updates only; blank creates a new employee.'),
                self::f('employee_status','Employment status','enum',false,'Employment','employees.work.edit',['active','resigned']),
                self::f('employee_classification','Classification','enum',true,'Employment','employees.personal.edit',['standard','five_percent']),
                self::f('gender','Gender','enum',true,'Personal','employees.personal.edit',['male','female']),
                self::f('arabic_full_name','Arabic full name','text',true,'Personal',null), self::f('english_full_name','English full name','text',true,'Personal',null),
                self::f('identity_card_number','National ID','text',true,'Personal',null), self::f('identity_card_expiration_date','National ID expiry','date',true,'Personal',null), self::f('date_of_birth','Date of birth','date',true,'Personal',null),
                self::f('religion_name','Religion','reference',true,'Personal',null,'religions'), self::f('marital_status_name','Marital status','reference',true,'Personal',null,'marital_statuses'), self::f('diploma_name','Diploma','reference',false,'Personal',null,'diplomas'), self::f('major','Major','text',false,'Personal',null), self::f('graduated_from','Graduated from','text',false,'Personal',null), self::f('phone','Phone','text',true,'Personal',null), self::f('governorate_name','Governorate','reference',true,'Personal',null,'governorates'), self::f('address','Address','text',false,'Personal',null),
                self::f('department_name','Department','reference',true,'Work',null,'departments'), self::f('shift_type_name','Shift type','reference',true,'Work',null,'shift_types'), self::f('team_name','Team','reference',false,'Work',null,'teams'), self::f('position_name','Position','reference',true,'Work',null,'positions'), self::f('project_name','Project','reference',false,'Work',null,'projects'), self::f('joining_date','Joining date','date',true,'Work',null), self::f('contract_signing_date','Contract signing date','date',true,'Work',null),
                self::f('bank_name','Bank','reference',false,'Financial',null,'banks'), self::f('bank_account_number','Bank account number','text',false,'Financial','employees.financial.edit'),
                self::f('social_insurance_active','Social Insurance active','boolean',false,'Insurance','employees.insurance.edit'), self::f('social_insurance_comment','Social Insurance notes','text',false,'Insurance','employees.insurance.edit'), self::f('form_1_incoming_number','Form 1 incoming number','text',false,'Insurance','employees.insurance.edit'), self::f('form_1_incoming_date','Form 1 incoming date','date',false,'Insurance','employees.insurance.edit'),
                self::f('leaving_date','Leaving date','date',false,'Lifecycle','employees.edit'), self::f('leaving_reason_name','Leaving reason','reference',false,'Lifecycle','employees.edit','leaving_reasons'), self::f('leaving_comment','Leaving notes','text',false,'Lifecycle','employees.edit'), self::f('annual_days_settled','Annual days settled','decimal',false,'Lifecycle','employees.edit'), self::f('form_6_incoming_number','Form 6 incoming number','text',false,'Lifecycle','employees.insurance.edit'), self::f('form_6_incoming_date','Form 6 incoming date','date',false,'Lifecycle','employees.insurance.edit'), self::f('form_6_reason','Form 6 reason','text',false,'Lifecycle','employees.edit'),
            ]],
            'spouses' => ['module'=>'Employees','title'=>'Spouses','import'=>'import_export.spouses.import','export'=>'import_export.spouses.export','fields'=>[
                self::f('employee_number','Employee Number','integer',true,'Employee link','employees.view','Existing employee number; matching spouse is Employee Number + National ID.'), self::f('wife_name','Spouse name','text',true,'Spouse',null), self::f('identity_card_number','National ID','text',true,'Spouse',null), self::f('is_working','Employed','boolean',false,'Spouse',null),
                array_merge(self::f('relationship_status','Relationship status','text',false,'Lifecycle','employees.personal.view'),['export_only'=>true]),
                array_merge(self::f('relationship_end_date','Marriage end effective date','date',false,'Lifecycle','employees.personal.view'),['export_only'=>true]),
                array_merge(self::f('marriage_end_reason','Marriage end reason','text',false,'Lifecycle','employees.personal.view'),['export_only'=>true]),
                array_merge(self::f('correction_reason','Record correction reason','text',false,'Lifecycle','employees.personal.view'),['export_only'=>true]),
            ]],
            'children' => ['module'=>'Employees','title'=>'Children','import'=>'import_export.children.import','export'=>'import_export.children.export','fields'=>[
                self::f('employee_number','Employee Number','integer',true,'Employee link','employees.view','Existing employee number; matching child is Employee Number + National ID.'), self::f('child_name','Child name','text',true,'Child',null), self::f('identity_card_number','National ID','text',true,'Child',null), self::f('wife_name','Spouse name (optional)','text',false,'Relationship',null,'Optional; must identify exactly one spouse by name for this employee.'),
            ]],
            'licenses' => ['module'=>'Employees','title'=>'Licenses','import'=>'import_export.licenses.import','export'=>'import_export.licenses.export','fields'=>[
                self::f('employee_number','Employee Number','integer',true,'Employee link','employees.view','Existing HMS Employee Number; no employee details are repeated.'), self::f('license_type_name','License type','reference',true,'License',null,'license_types'), self::f('release_date','Release date','date',true,'License',null), self::f('expiry_date','Expiry date','date',true,'License',null),
            ]],
            'social_insurance' => ['module'=>'Employees','title'=>'Social Insurance records','import'=>'import_export.social_insurance.import','export'=>'import_export.social_insurance.export','fields'=>[
                self::f('employee_number','Employee Number','integer',true,'Employee link','employees.view','Existing Employee Number; one Social Insurance record per employee.'), self::f('form_1_installation_date','Form 1 installation date','date',false,'Form 1',null), self::f('form_1_social_insurance_number','Form 1 insurance number','text',false,'Form 1',null), self::f('form_1_incoming_number','Form 1 incoming number','text',false,'Form 1',null), self::f('form_1_incoming_date','Form 1 incoming date','date',false,'Form 1',null), self::f('form_1_insurance_status_text','Form 1 status','text',false,'Form 1',null), self::f('form_1_notes','Form 1 notes','text',false,'Form 1',null), self::f('form_6_termination_date','Form 6 termination date','date',false,'Form 6',null), self::f('form_6_termination_reason','Form 6 reason','text',false,'Form 6',null), self::f('form_6_social_insurance_number','Form 6 insurance number','text',false,'Form 6',null), self::f('form_6_incoming_number','Form 6 incoming number','text',false,'Form 6',null), self::f('form_6_incoming_date','Form 6 incoming date','date',false,'Form 6',null), self::f('form_6_insurance_status_text','Form 6 status','text',false,'Form 6',null), self::f('form_6_notes','Form 6 notes','text',false,'Form 6',null),
            ]],
            'hiring_plans' => ['module'=>'Hiring Plan','title'=>'Hiring Plans','import'=>'import_export.hiring_plans.import','export'=>'import_export.hiring_plans.export','fields'=>[
                self::f('project_name','Project','reference',true,'Plan','hiring_plans.view','projects'), self::f('department_name','Department','reference',true,'Plan','hiring_plans.view','departments'), self::f('position_name','Position','reference',true,'Plan','hiring_plans.view','positions'), self::f('planned_count','Planned headcount','integer',true,'Plan','hiring_plans.view'),
            ]],
        ];
        foreach (['departments','teams','positions','projects','banks','license_types','religions','marital_statuses','diplomas','governorates','shift_types','leaving_reasons'] as $resource) {
            $title=ucwords(str_replace('_',' ',$resource));
            $fields=[self::f('name','Name','text',true,'Setup','setup.view'),self::f('description','Description','text',false,'Setup','setup.view'),self::f('is_active','Active','boolean',false,'Setup','setup.view')];
            if($resource==='positions') array_splice($fields,1,0,[self::f('position_code','Position code','text',true,'Setup','setup.view')]);
            if($resource==='governorates') $fields[]=self::f('participates_in_comprehensive_health_insurance','Participates in comprehensive health insurance','boolean',false,'Setup','setup.view');
            $schemas['setup_' . $resource]=['module'=>'SetUp','title'=>$title,'import'=>'import_export.setup_' . $resource . '.import','export'=>'import_export.setup_' . $resource . '.export','table'=>$resource,'fields'=>$fields];
        }
        $schemas['documents']=['module'=>'Documents & Compliance','title'=>'Employee document metadata','import'=>null,'export'=>'import_export.documents.export','table'=>'employee_documents','fields'=>[
            self::f('employee_number','Employee Number','integer',true,'Employee link','employees.view'),self::f('document_type_name','Document type','text',true,'Document','employees.documents.view'),self::f('status','Document status','text',true,'Document','employees.documents.view'),self::f('reference_number','Reference number','text',false,'Document','employees.documents.view'),self::f('issued_on','Issued on','date',false,'Document','employees.documents.view'),self::f('expires_on','Expires on','date',false,'Document','employees.documents.view'),
        ]];
        $schemas['contract_renewals']=['module'=>'Contracts','title'=>'Contract renewal history','import'=>null,'export'=>'import_export.contract_renewals.export','table'=>'employee_contract_renewals','fields'=>[
            self::f('employee_number','Employee Number','integer',true,'Employee link','employees.work.view'),self::f('previous_contract_signing_date','Previous signing date','date',true,'Contract','employees.work.view'),self::f('previous_contract_expiration_date','Previous expiry date','date',true,'Contract','employees.work.view'),self::f('renewal_signing_date','Renewal signing date','date',true,'Contract','employees.work.view'),self::f('renewal_expiration_date','Renewal expiry date','date',true,'Contract','employees.work.view'),
        ]];
        return $schemas;
    }

    /** @return array<string,mixed> */
    public static function get(string $key): array
    {
        $schema = self::all()[$key] ?? null;
        if (!is_array($schema)) throw new \InvalidArgumentException('Choose a supported data type.');
        return $schema;
    }

    /** @return array<string,mixed> */
    private static function f(string $key, string $label, string $type, bool $required, string $section, mixed $permission = null, mixed $detail = null): array
    {
        $field = ['key'=>$key,'label'=>$label,'type'=>$type,'required'=>$required,'section'=>$section];
        if ($permission !== null) $field['permission'] = $permission;
        if ($detail !== null) $field['detail'] = $detail;
        if ($type === 'enum') $field['values'] = $detail;
        if ($type === 'reference') $field['table'] = $detail;
        return $field;
    }
}
