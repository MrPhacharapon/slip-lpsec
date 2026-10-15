import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoster,identifyPageSlips,assertUniquePeriod,SlipValidationError} from '../src/lib/slip-validation.ts';

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
