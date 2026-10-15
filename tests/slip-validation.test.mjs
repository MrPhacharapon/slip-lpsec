import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoster,identifyPageSlips,assertUniquePeriod,SlipValidationError,validateSlipPageLayout} from '../src/lib/slip-validation.ts';

const roster=parseRoster([
  ['ชื่อ-นามสกุล','ตำแหน่ง','เลขที่บัญชี'],
  ['นายตัวอย่าง หนึ่ง','ครู','1234567890'],
  ['นางสาวตัวอย่าง สอง','ครู','0987654321'],
]);
const heading='ใบรับรองการจ่ายเงินเดือน ชื่อ-นามสกุล ';
const top={str:heading+'นายตัวอย่าง หนึ่ง เลขที่บัญชี 1234567890',y:650};
const bottom={str:heading+'นางสาวตัวอย่าง สอง เลขที่บัญชี 0987654321',y:180};

test('two-person page maps top and bottom independently',()=>{
  assert.deepEqual(identifyPageSlips([top,bottom],842,roster).map(x=>x.region),['top','bottom']);
});
test('PDF digit text items split into single characters are matched',()=>{
  const tokens=[{str:heading+'นายตัวอย่าง หนึ่ง เลขที่บัญชี ',y:650},
    ...'1234567890'.split('').map(str=>({str,y:650}))];
  assert.equal(identifyPageSlips(tokens,842,roster)[0].person.bankAccount,'1234567890');
});
test('a second unidentifiable slip must fail closed',()=>{
  assert.throws(()=>identifyPageSlips([top,{str:heading+'นางสาวตัวอย่าง สอง ไม่พบเลขบัญชี',y:180}],842,roster),SlipValidationError);
});
test('wrong name and valid account must fail',()=>{
  assert.throws(()=>identifyPageSlips([{str:heading+'นางสาวตัวอย่าง สอง เลขที่บัญชี 1234567890',y:650}],842,roster),SlipValidationError);
});
test('unknown bank account must fail without roster order fallback',()=>{
  assert.throws(()=>identifyPageSlips([{str:heading+'นายไม่ทราบชื่อ เลขที่บัญชี 5555555555',y:650}],842,roster),SlipValidationError);
});
test('single full page with verified identity succeeds',()=>{
  assert.equal(identifyPageSlips([top,{str:'เงินเดือน',y:180}],842,roster)[0].region,'full');
});
test('roster duplicates fail',()=>{
  assert.throws(()=>parseRoster([['นายก','','1234567890'],['นายข','','1234567890']]),SlipValidationError);
});
test('leading zero survives account separator normalization',()=>{
  assert.equal(parseRoster([['นางสาวตัวอย่าง สอง','','098-765-4321']])[0].bankAccount,'0987654321');
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
  const ambiguous={str:heading+'นายตัวอย่าง หนึ่ง เลขที่บัญชี 1234567890 และ นางสาวตัวอย่าง สอง',y:650};
  assert.throws(()=>identifyPageSlips([ambiguous],842,roster),SlipValidationError);
});

const pageHeader = (month, y, withAccountLabel = true) => [
  {str: 'ใบรับรองการจ่ายเงินเดือนและเงินอื่น ประจำเดือน '+month+' ปี พ.ศ. 2569',y},
  {str: 'ชื่อ -นามสกุล นายทดสอบ เอกสาร', y:y-27},
  {str: 'เลขตำแหน่ง 0000000 เลขที่บัญชี'+(withAccountLabel?' 1234567890':''),y:y-50},
];

test('actual 1071x792 January-August geometry is single-slip',()=>{
  assert.equal(validateSlipPageLayout(pageHeader('มกราคม',780),1071,792,'มกราคม','2569'),'single');
});
test('actual 1071x792 September-October geometry is two-slip',()=>{
  assert.equal(validateSlipPageLayout(
    [...pageHeader('กันยายน',780),...pageHeader('กันยายน',384)],
    1071,792,'กันยายน','2569'), 'double');
});
test('document month mismatch is rejected',()=>{
  assert.throws(()=>validateSlipPageLayout(pageHeader('เมษายน',780),1071,792,'พฤษภาคม','2569'),SlipValidationError);
});
test('unexpected PDF dimensions are rejected',()=>{
  assert.throws(()=>validateSlipPageLayout(pageHeader('มกราคม',780),595,842,'มกราคม','2569'),SlipValidationError);
});
test('missing bottom header but residual bank details are rejected',()=>{
  const pdf=[...pageHeader('ตุลาคม',780),
    {str:'ชื่อ -นามสกุล บุคคลอื่น เลขที่บัญชี 0987654321',y:315}];
  assert.throws(()=>validateSlipPageLayout(pdf,1071,792,'ตุลาคม','2569'),SlipValidationError);
});
test('mixed printed months in two halves are rejected',()=>{
  assert.throws(()=>validateSlipPageLayout(
    [...pageHeader('กันยายน',780),...pageHeader('ตุลาคม',384)],
    1071,792,'กันยายน','2569'),SlipValidationError);
});
