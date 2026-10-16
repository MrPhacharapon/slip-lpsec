import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoster,identifyPageSlips,assertUniquePeriod,SlipValidationError,validateSlipPageLayout} from '../src/lib/slip-validation.ts';

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
test('printed month/year mismatch is intentionally not checked',()=>{
  assert.equal(validateSlipPageLayout(pageHeader('เมษายน',780),1071,792),'single');
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
