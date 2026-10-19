import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoster,identifyPageSlips,assertUniquePeriod,assertSlipDocumentLayout,SlipValidationError,validateSlipPageLayout,assertSlipPagePeriod,diagnosePrintedPeriodSignals} from '../src/lib/slip-validation.ts';

const roster=parseRoster([
  ['ชื่อ-นามสกุล','ตำแหน่ง','เลขที่บัญชี','รายการรายรับ (เลขตำแหน่ง)'],
  ['นายตัวอย่าง หนึ่ง','ครู','1234567890','0000001'],
  ['นางสาวตัวอย่าง สอง','ครู','0987654321','0000002'],
]);
const heading='ใบรับรองการจ่ายเงินเดือน ชื่อ-นามสกุล ';
const top={str:heading+'นายตัวอย่าง หนึ่ง เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890',y:650};
const bottom={str:heading+'นางสาวตัวอย่าง สอง เลขตำแหน่ง 0000002 เลขที่บัญชี 0987654321',y:180};

test('two-person page maps top and bottom independently',()=>{
  assert.deepEqual(identifyPageSlips([top,bottom],842,roster).map(x=>x.region),['top','bottom']);
});
test('PDF digit text items split into single characters are matched',()=>{
  const tokens=[{str:heading+'นายตัวอย่าง หนึ่ง เลขตำแหน่ง 0000001 เลขที่บัญชี ',y:650},
    ...'1234567890'.split('').map(str=>({str,y:650}))];
  assert.equal(identifyPageSlips(tokens,842,roster)[0].person.bankAccount,'1234567890');
});
test('a second unidentifiable slip must fail closed',()=>{
  assert.throws(()=>identifyPageSlips([top,{str:heading+'นางสาวตัวอย่าง สอง ไม่พบเลขบัญชี',y:180}],842,roster),SlipValidationError);
});
test('wrong name and valid account must fail',()=>{
  assert.throws(()=>identifyPageSlips([{str:heading+'นางสาวตัวอย่าง สอง เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890',y:650}],842,roster),SlipValidationError);
});
test('unknown bank account must fail without roster order fallback',()=>{
  assert.throws(()=>identifyPageSlips([{str:heading+'นายไม่ทราบชื่อ เลขตำแหน่ง 0000001 เลขที่บัญชี 5555555555',y:650}],842,roster),SlipValidationError);
});
test('single full page with verified identity succeeds',()=>{
  assert.equal(identifyPageSlips([top,{str:'เงินเดือน',y:180}],842,roster)[0].region,'full');
});
test('roster duplicates fail',()=>{
  assert.throws(()=>parseRoster([['นายก','','1234567890','0000001'],['นายข','','1234567890','0000002']]),SlipValidationError);
});
test('leading zero survives account separator normalization',()=>{
  assert.equal(parseRoster([['นางสาวตัวอย่าง สอง','','098-765-4321','0000002']])[0].bankAccount,'0987654321');
});
test('duplicate account across source pages fails',()=>{
  const item=identifyPageSlips([top],842,roster)[0];
  assert.throws(()=>assertUniquePeriod([item,item]),SlipValidationError);
});

test("reject another roster person's name even when OCR misses their bank account and heading",()=>{
  const secondLine={str:'นางสาวตัวอย่าง สอง',y:180};
  assert.throws(()=>identifyPageSlips([top,secondLine],842,roster),SlipValidationError);
});
test('reject if another roster name is embedded within the same detected half',()=>{
  const ambiguous={str:heading+'นายตัวอย่าง หนึ่ง เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890 และ นางสาวตัวอย่าง สอง',y:650};
  assert.throws(()=>identifyPageSlips([ambiguous],842,roster),SlipValidationError);
});


const pageHeader = (month, y) => [
  {str: 'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน '+month+' ปี พ.ศ. 2569',y},
  {str: 'ชื่อ -นามสกุล นายทดสอบ เอกสาร', y:y-27},
  {str: 'เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890',y:y-50},
];

test('A: one heading and one slip on a full page',()=>{
  assert.equal(validateSlipPageLayout(pageHeader('มกราคม',780),1071,792),'single');
});
test('B: two headings and two slips on one page',()=>{
  assert.equal(validateSlipPageLayout([...pageHeader('กันยายน',780),
    ...pageHeader('กันยายน',384)],1071,792),'double');
});
test('B: odd headcount allows only one heading and one slip on the last page',()=>{
  assert.equal(validateSlipPageLayout(pageHeader('กันยายน',780),1071,792),'single');
});
test('period matches exactly one header per slip half',()=>{
  const single=pageHeader('กันยายน',780);
  const both=[...single,...pageHeader('กันยายน',384)];
  assert.doesNotThrow(()=>assertSlipPagePeriod(single,792,'single','กันยายน','2569'));
  assert.doesNotThrow(()=>assertSlipPagePeriod(both,792,'double','กันยายน','2569'));
  assert.throws(()=>assertSlipPagePeriod(single,792,'single','ตุลาคม','2569'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod(single,792,'single','กันยายน','2568'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod([...single,...pageHeader('ตุลาคม',384)],792,'double','กันยายน','2569'),SlipValidationError);
});
test('missing duplicated and split PDF.js Thai heading year',()=>{
  const tokens=[{str:'ใบรับรองการจ่ายเงินเดือนฯ ประจำเดือน กันยายน ปี พ\u0000ศ\u0000',y:780},
    {str:' ๒๕๖๙',y:780}];
  assert.doesNotThrow(()=>assertSlipPagePeriod(tokens,792,'single','กันยายน','2569'));
  assert.throws(()=>assertSlipPagePeriod([{str:'ปี พ.ศ. 2569',y:780}],792,'single','กันยายน','2569'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod([...tokens,...tokens],792,'single','กันยายน','2569'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod(tokens,792,'single','ก.ย.','2569'),SlipValidationError);
});
test('unexpected PDF dimensions are rejected',()=>{
  assert.throws(()=>validateSlipPageLayout(pageHeader('มกราคม',780),595,842),SlipValidationError);
});
test('incomplete bottom slip heading is rejected',()=>{
  const pdf=[...pageHeader('ตุลาคม',780),
    {str:'ชื่อ -นามสกุล บุคคลอื่น เลขที่บัญชี 0987654321',y:315}];
  assert.throws(()=>validateSlipPageLayout(pdf,1071,792),SlipValidationError);
});
test('three headings with two in the same half are rejected',()=>{
  const pdf=[...pageHeader('กันยายน',780),...pageHeader('กันยายน',700),...pageHeader('กันยายน',384)];
  assert.throws(()=>validateSlipPageLayout(pdf,1071,792),SlipValidationError);
});
test('wrong position number prevents matching even when name and account match',()=>{
  const wrong={str:heading+'นายตัวอย่าง หนึ่ง เลขตำแหน่ง 0000999 เลขที่บัญชี 1234567890',y:650};
  assert.throws(()=>identifyPageSlips([wrong],842,roster),SlipValidationError);
});
test('missing position number prevents matching',()=>{
  const wrong={str:heading+'นายตัวอย่าง หนึ่ง เลขที่บัญชี 1234567890',y:650};
  assert.throws(()=>identifyPageSlips([wrong],842,roster),SlipValidationError);
});
test('name whitespace is ignored when matching all three fields',()=>{
  const noSpace={str:heading+'นายตัวอย่างหนึ่ง เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890',y:650};
  assert.equal(identifyPageSlips([noSpace],842,roster)[0].person.positionNumber,'0000001');
});
test('position from the other half cannot validate a different person',()=>{
  const wrong={str:heading+'นายตัวอย่าง หนึ่ง เลขที่บัญชี 1234567890',y:650};
  assert.throws(()=>identifyPageSlips([wrong,bottom],842,roster),SlipValidationError);
});
test('duplicate printed position labels in the same slip fail closed',()=>{
  const wrong={str:heading+'นายตัวอย่าง หนึ่ง เลขตำแหน่ง 0000001 เลขตำแหน่ง 0000001 เลขที่บัญชี 1234567890',y:650};
  assert.throws(()=>identifyPageSlips([wrong],842,roster),SlipValidationError);
});


test('upload accepts exactly 500 distinct mapped slips before staging', () => {
  const mapped = Array.from({ length: 500 }, (_, i) => ({
    person: { ...roster[0], bankAccount: String(9000000000 + i) },
    region: 'full',
  }));
  assert.doesNotThrow(() => assertUniquePeriod(mapped));
});

test('upload refuses 501 distinct slips before any database staging', () => {
  const mapped = Array.from({ length: 501 }, (_, i) => ({
    person: { ...roster[0], bankAccount: String(9000000000 + i) },
    region: i % 2 ? 'bottom' : 'top',
  }));
  assert.throws(() => assertUniquePeriod(mapped), err =>
    err instanceof SlipValidationError && /500/.test(err.message));
});


test('full A document accepts single-person page sequence', () => {
  assert.doesNotThrow(() => assertSlipDocumentLayout(['single','single','single']));
});
test('compact B document accepts double pages and one odd final single', () => {
  for (const pages of [
    ['double'], ['double','double'], ['double','single'],
    ['double','double','single'],
  ]) assert.doesNotThrow(() => assertSlipDocumentLayout(pages));
});
test('mixed A then B must fail at original page 1', () => {
  assert.throws(() => assertSlipDocumentLayout(['single','double']),
    error => error instanceof SlipValidationError && error.page === 1);
});
test('B with a single-person middle page must fail at that page', () => {
  assert.throws(() => assertSlipDocumentLayout(['double','single','double']),
    error => error instanceof SlipValidationError && error.page === 2);
});
test('B cannot have two single-person final pages', () => {
  assert.throws(() => assertSlipDocumentLayout(['double','single','single']),
    error => error instanceof SlipValidationError && error.page === 2);
});
test('empty document must fail', () => {
  assert.throws(() => assertSlipDocumentLayout([]), SlipValidationError);
});
test('unknown page layout must fail', () => {
  assert.throws(() => assertSlipDocumentLayout(['double','unknown']), SlipValidationError);
});

test('private period hints distinguish real mismatches from unparsable period text', () => {
  const good=pageHeader('มกราคม',780);
  const printedOtherMonth=pageHeader('กันยายน',780);
  const printedOtherYear=[{str:'ประจำเดือนมกราคมปีพ.ศ.2568',y:780}];
  const brokenFormat=[{str:'ประจำเดือน - มกราคม : พ.ศ.2569',y:780}];
  const missingLabel=[{str:'มกราคม พ.ศ. 2569',y:780}];
  assert.deepEqual(diagnosePrintedPeriodSignals(good,792,'single','มกราคม','2569'),[
    {periodLabel:true,selectedMonth:true,selectedYear:true,recognizedPattern:true}]);
  assert.deepEqual(diagnosePrintedPeriodSignals(printedOtherMonth,792,'single','มกราคม','2569'),[
    {periodLabel:true,selectedMonth:false,selectedYear:true,recognizedPattern:true}]);
  assert.deepEqual(diagnosePrintedPeriodSignals(printedOtherYear,792,'single','มกราคม','2569'),[
    {periodLabel:true,selectedMonth:true,selectedYear:false,recognizedPattern:true}]);
  assert.deepEqual(diagnosePrintedPeriodSignals(brokenFormat,792,'single','มกราคม','2569'),[
    {periodLabel:true,selectedMonth:true,selectedYear:true,recognizedPattern:false}]);
  assert.deepEqual(diagnosePrintedPeriodSignals(missingLabel,792,'single','มกราคม','2569'),[
    {periodLabel:false,selectedMonth:true,selectedYear:true,recognizedPattern:false}]);
  // Diagnostics must never bypass strict acceptance of a loose printed period.
  assert.throws(()=>assertSlipPagePeriod(brokenFormat,792,'single','มกราคม','2569'),SlipValidationError);
});
test('private period hints are separated by PDF half and never echo tokens', () => {
  const a=pageHeader('มกราคม',780), b=pageHeader('กันยายน',384);
  const hints=diagnosePrintedPeriodSignals([...a,...b],792,'double','มกราคม','2569');
  assert.equal(hints.length,2);
  assert.equal(hints[0].selectedMonth,true);
  assert.equal(hints[1].selectedMonth,false);
  const serialized=JSON.stringify(hints);
  assert.ok(!serialized.includes('ชื่อ'));
  assert.ok(!serialized.includes('1234567890'));
});

test('real-like content stream puts period value before its printed label',()=>{
  const reversed=[
    {str:'มกราคม ปี พ.ศ. 2569',x:529,y:780},
    {str:'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน ',x:304,y:781.5},
    {str:'ชื่อ -นามสกุล นายทดสอบ',x:12,y:748},
  ];
  assert.doesNotThrow(()=>assertSlipPagePeriod(reversed,792,'single','มกราคม','2569'));
  assert.throws(()=>assertSlipPagePeriod(reversed,792,'single','กุมภาพันธ์','2569'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod(reversed,792,'single','มกราคม','2568'),SlipValidationError);
  assert.equal(diagnosePrintedPeriodSignals(reversed,792,'single','มกราคม','2569')[0].recognizedPattern,true);
});
test('reordered period must be on the exact heading line; not elsewhere',()=>{
  const outside=[
    {str:'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน',x:304,y:780},
    {str:'มกราคม ปี พ.ศ. 2569',x:529,y:750},
    {str:'รายรับ',x:15,y:710},
  ];
  assert.throws(()=>assertSlipPagePeriod(outside,792,'single','มกราคม','2569'),SlipValidationError);
});
test('reordered header does not accept duplicate or contradictory printed periods',()=>{
  const reversed=[
    {str:'มกราคม ปี พ.ศ. 2569',x:529,y:780},
    {str:'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน',x:304,y:781.5},
    {str:'ประจำเดือน กุมภาพันธ์ ปี พ.ศ. 2569',x:304,y:760},
  ];
  assert.throws(()=>assertSlipPagePeriod(reversed,792,'single','มกราคม','2569'),SlipValidationError);
  assert.throws(()=>assertSlipPagePeriod(reversed,792,'single','กุมภาพันธ์','2569'),SlipValidationError);
});
test('reordered heading is verified separately for both halves of compact page',()=>{
  const top=[
    {str:'กันยายน ปี พ.ศ. 2569',x:529,y:780},
    {str:'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน',x:304,y:781.5},
  ];
  const bottom=[
    {str:'กันยายน ปี พ.ศ. 2569',x:529,y:384},
    {str:'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน',x:304,y:385.5},
  ];
  assert.doesNotThrow(()=>assertSlipPagePeriod([...top,...bottom],792,'double','กันยายน','2569'));
  const invalid=[...top,{...bottom[0],str:'ตุลาคม ปี พ.ศ. 2569'},bottom[1]];
  assert.throws(()=>assertSlipPagePeriod(invalid,792,'double','กันยายน','2569'),SlipValidationError);
});
