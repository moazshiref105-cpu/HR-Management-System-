<?php

declare(strict_types=1);

namespace Hms\Backend;

use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

/** Small, bounded OOXML reader/writer for the plain-data workbooks HMS creates. */
final class ImportExportWorkbook
{
    // The deployed PHP runtime must accept multipart bodies above this value;
    // current local PHP configuration is upload_max_filesize=2M, post_max_size=8M.
    public const MAX_FILE_BYTES = 2_097_152;
    public const MAX_ROWS = 20_000;
    private const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    private const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    private const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

    /** @param array<string,mixed> $schema @param array<string,list<string>> $dropdowns */
    public static function template(array $schema, string $dataType, array $dropdowns = []): string
    {
        $fields = $schema['fields'];
        $headings=array_map(static fn(array $field):string=>$field['label'] . ($field['required']?' *':''),$fields);
        $instructions = [
            ['HMS · IMPORT & EXPORT CENTER', 'Welcome to your guided HMS workbook'],
            ['Data type', $schema['title']],
            ['Template version', (string) ImportExportSchema::VERSION],
            ['How to use this file', 'Keep the marker in cell A1 and the column headings in row 2. Enter one record per row starting at row 3. Do not rename or reorder columns.'],
            ['Review before upload', 'A * marks required columns. Dates use YYYY-MM-DD. Employee-linked rows use Employee Number, never a database ID. Blank optional cells are left unchanged on update.'],
            ['Matching rule', self::matchingRule($dataType)],
            ['Fields', 'Required fields are marked “Required”; all others are optional. Reference fields use the exact name of an active Setup item.'],
        ];
        foreach ($fields as $field) {
            $instructions[] = [$field['label'] . ($field['required'] ? ' · Required' : ' · Optional'), self::fieldDescription($field)];
        }
        $dataRows = [
            ['HMS_TEMPLATE|' . $dataType . '|' . ImportExportSchema::VERSION],
            $headings,
        ];
        return self::build([
            ['name'=>'Instructions','rows'=>$instructions,'widths'=>[30,110],'header'=>true],
            ['name'=>'Data','rows'=>$dataRows,'widths'=>array_fill(0, count($fields), 24),'headerRow'=>2,'filterRow'=>2,'freezeRow'=>2,'validations'=>self::validations($fields,$dropdowns)],
            ['name'=>'Example','rows'=>[['Synthetic example only · Do not upload this sheet'],$headings,array_map(static fn(array $field): string => self::example($field),$fields)],'widths'=>array_fill(0,count($fields),24),'headerRow'=>2],
        ], $schema['title'], 'Template version ' . ImportExportSchema::VERSION);
    }

    /** @return array{version:int,rows:list<array{row:int,data:array<string,mixed>}>} */
    public static function parse(string $path, string $dataType, array $fields): array
    {
        if (!is_file($path) || filesize($path) > self::MAX_FILE_BYTES) throw new RuntimeException('Workbook exceeds the 2 MB upload limit.');
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::RDONLY) !== true) throw new RuntimeException('The uploaded file is not a readable Excel workbook.');
        try {
            if ($zip->numFiles > 100) throw new RuntimeException('The workbook contains too many internal files.');
            $expanded=0;
            for($i=0;$i<$zip->numFiles;$i++) { $stat=$zip->statIndex($i); $expanded+=(int)($stat['size']??0); if((int)($stat['size']??0)>self::MAX_FILE_BYTES||$expanded>32_000_000) throw new RuntimeException('The workbook expands beyond the permitted safety limit.'); }
            $contentTypes=$zip->getFromName('[Content_Types].xml');
            if(!is_string($contentTypes)||!str_contains($contentTypes,'spreadsheetml.sheet.main+xml')||preg_match('/macroEnabled|vbaProject|externalLink/i',$contentTypes)) throw new RuntimeException('Only standard, macro-free Excel workbooks are supported.');
            $workbook = self::xml($zip->getFromName('xl/workbook.xml'));
            $rels = self::xml($zip->getFromName('xl/_rels/workbook.xml.rels'));
            $sheetPath = null;
            foreach ($workbook->children(self::MAIN_NS)->sheets->children(self::MAIN_NS)->sheet as $sheet) {
                if (self::attribute($sheet, 'name') !== 'Data') continue;
                $rid = (string) $sheet->attributes(self::REL_NS)['id'];
                foreach ($rels->children(self::PKG_REL_NS)->Relationship as $relationship) {
                    $target=self::attribute($relationship,'Target');
                    if(self::attribute($relationship,'Id')!==$rid) continue;
                    if(preg_match('#^worksheets/sheet[0-9]+\.xml$#',$target)) $sheetPath='xl/' . $target;
                    elseif(preg_match('#^/xl/worksheets/sheet[0-9]+\.xml$#',$target)) $sheetPath=ltrim($target,'/');
                }
            }
            if ($sheetPath === null || !str_starts_with($sheetPath, 'xl/worksheets/')) throw new RuntimeException('Required Data sheet was not found. Download a current HMS template.');
            $sheet = self::xml($zip->getFromName($sheetPath));
            $shared = self::sharedStrings($zip->getFromName('xl/sharedStrings.xml'));
            $rows = [];
            foreach ($sheet->children(self::MAIN_NS)->sheetData->children(self::MAIN_NS)->row as $row) {
                $rowNumber = (int) self::attribute($row, 'r');
                if ($rowNumber > self::MAX_ROWS + 2) throw new RuntimeException('The workbook exceeds the 20,000 row limit.');
                $cells = [];
                foreach ($row->children(self::MAIN_NS)->c as $cell) {
                    $reference = self::attribute($cell, 'r');
                    $column = self::columnIndex($reference);
                    if(isset($cell->children(self::MAIN_NS)->f)) throw new RuntimeException('Formula cells are not accepted. Paste values into the workbook before upload.');
                    $cells[$column] = self::cellValue($cell, $shared);
                }
                $rows[$rowNumber] = $cells;
            }
            if (($rows[1][0] ?? '') !== 'HMS_TEMPLATE|' . $dataType . '|' . ImportExportSchema::VERSION) throw new RuntimeException('This template is missing or outdated. Download the latest HMS template for this data type.');
            $headers = array_map(static fn(array $field): string => $field['label'] . ($field['required']?' *':''), $fields);
            if (($rows[2] ?? []) !== array_combine(array_keys($headers), $headers)) throw new RuntimeException('The Data sheet headings differ from the current template. Download a fresh template.');
            $result = [];
            for ($n=3; $n <= max(array_keys($rows)); $n++) {
                $cells = $rows[$n] ?? [];
                if (count(array_filter($cells, static fn($value): bool => trim((string) $value) !== '')) === 0) continue;
                $data = [];
                foreach ($fields as $index=>$field) {
                    $value = $cells[$index] ?? null;
                    if (is_string($value)) $value = trim($value);
                    if ($value === '') $value = null;
                    if ($value !== null && $field['type'] === 'date' && is_numeric($value)) $value = self::excelDate((float) $value);
                    $data[$field['key']] = $value;
                }
                $result[] = ['row'=>$n,'data'=>$data];
            }
            return ['version'=>ImportExportSchema::VERSION,'rows'=>$result];
        } finally {
            $zip->close();
        }
    }

    /** @param list<array<string,mixed>> $fields @param list<array<string,mixed>> $rows */
    public static function export(array $fields, array $rows, string $title, array $metadata = []): string
    {
        $meta = [['HMS · IMPORT & EXPORT CENTER',$title],['Generated',gmdate('Y-m-d H:i:s') . ' UTC'],['Record count',(string) count($rows)]];
        foreach ($metadata as $label=>$value) $meta[] = [(string) $label, (string) $value];
        $head = array_column($fields,'label');
        $body = array_map(static function(array $row) use ($fields): array { return array_map(static fn(array $field): mixed => $row[$field['key']] ?? '',$fields); },$rows);
        return self::build([
            ['name'=>'Summary','rows'=>$meta,'widths'=>[28,100],'header'=>true],
            ['name'=>'Data','rows'=>array_merge([['HMS export · ' . $title],$head],$body),'widths'=>array_map(static fn(array $f): int => min(42,max(18,(int) ceil(strlen($f['label']) * 1.2))),$fields),'fieldTypes'=>array_column($fields,'type'),'fieldKeys'=>array_column($fields,'key'),'headerRow'=>2,'filterRow'=>2,'freezeRow'=>2],
        ],$title,'Generated ' . gmdate('Y-m-d H:i:s') . ' UTC · ' . count($rows) . ' records');
    }

    /** @param list<array{name:string,rows:list<array>,widths:list<int>,header?:bool,headerRow?:int,filterRow?:int,freezeRow?:int,validations?:list<array>}> $sheets */
    private static function build(array $sheets,string $title,string $subtitle): string
    {
        if (!class_exists(ZipArchive::class)) throw new RuntimeException('The PHP ZIP extension is required to create Excel files.');
        $tmp = tempnam(sys_get_temp_dir(),'hms-xlsx-'); if ($tmp === false) throw new RuntimeException('Unable to create a temporary workbook.');
        $zip = new ZipArchive();
        try {
            if ($zip->open($tmp,ZipArchive::OVERWRITE)!==true) throw new RuntimeException('Unable to build Excel workbook.');
            $zip->addFromString('[Content_Types].xml',self::contentTypes(count($sheets)));
            $zip->addFromString('_rels/.rels',self::rootRels());
            $zip->addFromString('xl/workbook.xml',self::workbookXml($sheets));
            $zip->addFromString('xl/_rels/workbook.xml.rels',self::workbookRels(count($sheets)));
            $zip->addFromString('xl/styles.xml',self::styles());
            foreach ($sheets as $index=>$sheet) $zip->addFromString('xl/worksheets/sheet' . ($index+1) . '.xml',self::sheetXml($sheet));
            $zip->close();
            $data=file_get_contents($tmp); if (!is_string($data)) throw new RuntimeException('Unable to read the generated workbook.');
            return $data;
        } finally { @unlink($tmp); }
    }

    private static function sheetXml(array $sheet): string
    {
        $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' . self::MAIN_NS . '">';
        $freeze=(int)($sheet['freezeRow']??0);
        if ($freeze>0) $xml.='<sheetViews><sheetView workbookViewId="0"><pane ySplit="' . $freeze . '" topLeftCell="A' . ($freeze+1) . '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
        $xml.='<cols>'; foreach ($sheet['widths'] as $i=>$width) $xml.='<col min="' . ($i+1) . '" max="' . ($i+1) . '" width="' . max(12,min(60,(int)$width)) . '" customWidth="1"/>'; $xml.='</cols><sheetData>';
        foreach ($sheet['rows'] as $rowIndex=>$values) {
            $r=$rowIndex+1; $xml.='<row r="' . $r . '"' . ($r===1?' ht="28" customHeight="1"':((($sheet['header']??false)&&$r>1)?' ht="32" customHeight="1"':'')) . '>';
            foreach (array_values($values) as $column=>$value) {
                if ($value===null) continue;
                $headerRow=(int)($sheet['headerRow']??0);
                $style='';
                if((($sheet['header']??false)&&$r===1)||($headerRow>0&&$r===$headerRow)) $style=' s="2"';
                elseif($r===1) $style=' s="1"';
                elseif($headerRow>0&&$r>$headerRow&&$r%2===0) $style=' s="3"';
                elseif(($sheet['header']??false)&&$r%2===0) $style=' s="3"';
                if(($sheet['header']??false)&&$r>1&&$column===1) $style=' s="7"';
                $fieldType=$sheet['fieldTypes'][$column]??null; $fieldKey=$sheet['fieldKeys'][$column]??null;
                if($r>(int)($sheet['headerRow']??0)&&$fieldType==='date'&&is_string($value)&&preg_match('/^\d{4}-\d{2}-\d{2}$/',$value)&&checkdate((int)substr($value,5,2),(int)substr($value,8,2),(int)substr($value,0,4))) {
                    $serial=(int)((strtotime($value . ' UTC')-strtotime('1899-12-30 UTC'))/86400); $xml.='<c r="' . self::cellRef($column+1,$r) . '" s="4" t="n"><v>' . $serial . '</v></c>'; continue;
                }
                if($r>(int)($sheet['headerRow']??0)&&in_array($fieldType,['integer','decimal'],true)&&$fieldKey!=='employee_number'&&is_numeric($value)) {
                    $numberStyle=$fieldType==='integer'?'5':'6'; $numeric=(string)$value; if(!preg_match('/^-?\d+(?:\.\d+)?$/',$numeric)) $numeric=(string)(float)$value; $xml.='<c r="' . self::cellRef($column+1,$r) . '" s="' . $numberStyle . '" t="n"><v>' . self::escape($numeric) . '</v></c>'; continue;
                }
                $xml.='<c r="' . self::cellRef($column+1,$r) . '" t="inlineStr"' . $style . '><is><t xml:space="preserve">' . self::escape((string)$value) . '</t></is></c>';
            }
            $xml.='</row>';
        }
        $xml.='</sheetData>';
        if (isset($sheet['filterRow'],$sheet['widths']) && count($sheet['widths'])>0) $xml.='<autoFilter ref="A' . $sheet['filterRow'] . ':' . self::cellRef(count($sheet['widths']),count($sheet['rows'])) . '"/>';
        if (!empty($sheet['validations'])) {
            $xml.='<dataValidations count="' . count($sheet['validations']) . '">';
            foreach ($sheet['validations'] as $validation) $xml.='<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="' . self::cellRef($validation['column'],3) . ':' . self::cellRef($validation['column'],2002) . '"><formula1>"' . self::escape(implode(',',$validation['values'])) . '"</formula1></dataValidation>';
            $xml.='</dataValidations>';
        }
        return $xml . '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>';
    }

    private static function contentTypes(int $count): string { $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'; for($i=1;$i<=$count;$i++) $xml.='<Override PartName="/xl/worksheets/sheet' . $i . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; return $xml.'</Types>'; }
    private static function rootRels(): string { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' . self::PKG_REL_NS . '"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'; }
    private static function workbookXml(array $sheets): string { $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' . self::MAIN_NS . '" xmlns:r="' . self::REL_NS . '"><sheets>'; foreach($sheets as $i=>$s) $xml.='<sheet name="' . self::escape($s['name']) . '" sheetId="' . ($i+1) . '" r:id="rId' . ($i+1) . '"/>'; return $xml.'</sheets></workbook>'; }
    private static function workbookRels(int $count): string { $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' . self::PKG_REL_NS . '">'; for($i=1;$i<=$count;$i++) $xml.='<Relationship Id="rId' . $i . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $i . '.xml"/>'; $xml.='<Relationship Id="rId' . ($count+1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'; return $xml; }
    private static function styles(): string { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' . self::MAIN_NS . '"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173B5E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><bottom style="thin"><color rgb="FFD5E1EC"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>'; }
    private static function validations(array $fields,array $dropdowns): array { $out=[]; foreach($fields as $i=>$field) { $values=$field['values']??($field['type']==='reference'?($dropdowns[$field['table']]??[]):[]); if(is_array($values)&&$values!==[]) { $values=array_slice(array_map('strval',$values),0,50); if(strlen(implode(',',$values))<240) $out[]=['column'=>$i+1,'values'=>$values]; } } return $out; }
    private static function xml(mixed $value): SimpleXMLElement { if (!is_string($value)||$value==='') throw new RuntimeException('The workbook is missing a required Excel component.'); libxml_use_internal_errors(true); $parsed=simplexml_load_string($value,SimpleXMLElement::class,LIBXML_NONET|LIBXML_NOBLANKS); if(!$parsed) { libxml_clear_errors(); throw new RuntimeException('The workbook contains malformed XML.'); } libxml_clear_errors(); return $parsed; }
    private static function sharedStrings(mixed $value): array { if(!is_string($value)||$value==='') return []; $xml=self::xml($value); $out=[]; foreach($xml->children(self::MAIN_NS)->si as $item) { $text=''; foreach($item->children(self::MAIN_NS)->t as $node) $text.=(string)$node; foreach($item->children(self::MAIN_NS)->r as $run) $text.=(string)$run->children(self::MAIN_NS)->t; $out[]=$text; } return $out; }
    private static function cellValue(SimpleXMLElement $cell,array $shared): mixed { $type=self::attribute($cell,'t'); $children=$cell->children(self::MAIN_NS); if($type==='inlineStr') return (string)($children->is->t??''); $raw=(string)($children->v??''); if($type==='s') return $shared[(int)$raw]??''; if($type==='b') return $raw==='1'?'true':'false'; return $raw; }
    private static function attribute(SimpleXMLElement $element,string $name): string { return (string)($element->attributes()[$name]??''); }
    private static function columnIndex(string $reference): int { if(!preg_match('/^([A-Z]+)/',$reference,$m)) throw new RuntimeException('Workbook cell reference is invalid.'); $value=0; foreach(str_split($m[1]) as $char) $value=$value*26+ord($char)-64; return $value-1; }
    private static function cellRef(int $column,int $row): string { $letters=''; while($column>0) { $remainder=($column-1)%26; $letters=chr(65+$remainder).$letters; $column=intdiv($column-1,26); } return $letters.$row; }
    private static function excelDate(float $value): string { $days=(int)floor($value); return gmdate('Y-m-d',strtotime('1899-12-30 +' . $days . ' days')); }
    private static function escape(string $value): string { return htmlspecialchars($value,ENT_XML1|ENT_COMPAT,'UTF-8'); }
    private static function matchingRule(string $type): string { return match($type) { 'employees'=>'Existing rows update only when Employee Number is filled. New rows leave it blank; HMS generates the number. New employee rows require a unique National ID.','spouses'=>'Upsert by Employee Number + National ID; duplicate National IDs in one employee are rejected.','children'=>'Upsert by Employee Number + National ID. Spouse name is optional and must match exactly one spouse.','licenses'=>'Match by Employee Number + License type + release date + expiry date. Ambiguous existing matches are rejected.','social_insurance'=>'One record per Employee Number; a matching record is updated.','hiring_plans'=>'Upsert by Project + Department + Position.',default=>'Existing Setup items update by exact case-insensitive name; unknown names create a new item.'}; }
    private static function fieldDescription(array $field): string
    {
        if (is_string($field['detail'] ?? null)) return $field['detail'];
        return match($field['type']) {
            'date'=>'Enter a real Excel date or YYYY-MM-DD.',
            'enum'=>'Choose one of: ' . implode(', ', $field['values'] ?? []),
            'reference'=>'Use the exact name of an active Setup item.',
            'boolean'=>'Enter TRUE or FALSE.', 'integer'=>'Enter a whole number.',
            'decimal'=>'Enter a number using a dot for decimals.',
            default=>'Enter plain text; avoid formulas.',
        };
    }
    private static function example(array $field): string
    {
        if ($field['key'] === 'source_reference') return 'SYNTHETIC-001';
        if ($field['key'] === 'identity_card_number') return '00000000000000';
        if ($field['key'] === 'employee_number') return '';
        return match($field['type']) {
            'enum'=>(string)($field['values'][0] ?? ''), 'reference'=>'Example active Setup item',
            'date'=>'2026-01-01', 'integer'=>'1', 'decimal'=>'0', 'boolean'=>'FALSE',
            'text'=>match($field['key']) {'arabic_full_name'=>'مثال تجريبي','english_full_name'=>'Synthetic Example','phone'=>'01000000000','wife_name'=>'Synthetic Spouse','child_name'=>'Synthetic Child',default=>'Synthetic example'},
            default=>'',
        };
    }
}
