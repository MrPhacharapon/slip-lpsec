# ตรวจรับสลิปจริงในเครื่องส่วนตัว (ไม่อัปโหลดข้อมูลจริง)

**ขอบเขต:** เฉพาะไฟล์ PDF ที่ผู้ดูแลมีสิทธิ์ใช้ และโครงการ Supabase **sliplpsec-test** เท่านั้น ไม่ใช่คำอนุญาตให้ Merge, Deploy หรือแก้ Supabase Production

## สิ่งที่แยกจากกันโดยเจตนา

1. ตรวจ PDF.js บนคอมพิวเตอร์ส่วนตัวด้วยสลิปจริงและทะเบียนที่ส่งออกมาเป็น CSV: **อ่านอย่างเดียว** ไม่ติดต่อ Supabase และไม่บันทึกไฟล์ PDF ใหม่
2. ตรวจ Next.js API → Supabase Test ด้วยข้อมูล **สมมติที่สคริปต์สร้าง**: ไม่ใช้สลิปจริง ไม่เปิด Public Preview และต้องยืนยันว่าลบข้อมูล Test กลับหมดก่อนแสดง PASS
3. การตรวจ Backup/Restore และ Production Migration เป็นขั้นตอนอื่นที่ต้องมีการอนุมัติแยกต่างหาก โดยมีสคริปต์ตรวจความครบถ้วนของไฟล์สำรองแบบออฟไลน์สำหรับเตรียมหลักฐานได้ แต่ไม่ใช่การทดสอบกู้คืนฐานข้อมูลจริง

## 1. เตรียมเครื่อง Windows ที่ได้รับอนุญาต

ติดตั้ง Node.js 24 และ Git ใช้สำเนา Repository ในพื้นที่ส่วนตัว จำกัดสิทธิ์เข้าถึงโฟลเดอร์ PDF/CSV และไม่วางไฟล์จริงไว้ภายใน Repository

ใน PowerShell:

```powershell
git switch fix/payroll-pdf-validation-no-deploy
git pull --ff-only
npm ci
```

ส่งออกชีตแรกของทะเบียนต้นทางเป็น UTF-8 CSV โดยต้องมีคอลัมน์ 1 = ชื่อ–นามสกุล, 3 = เลขบัญชี 10 หลัก, 4 = เลขตำแหน่ง 7 หลัก และคงเลข 0 นำหน้า

ตรวจ PDF จริงด้วยการระบุที่อยู่ไฟล์ในเครื่องตนเอง:

```powershell
node --experimental-strip-types scripts/validate-private-payroll-pdfs.mjs `
  --roster "D:\PrivatePayroll\staff.csv" `
  --pdf "D:\PrivatePayroll\January.pdf" --month "มกราคม" --year "2569" `
  --pdf "D:\PrivatePayroll\February.pdf" --month "กุมภาพันธ์" --year "2569"
```

เพิ่ม `--pdf` + `--month` + `--year` สำหรับทุกไฟล์ (ไม่เกิน 24 ไฟล์ต่อคำสั่ง) โดยต้องระบุเดือน–ปีของ PDF ให้ตรงกับที่ตั้งใจอัปโหลด สคริปต์ใช้ PDF.js อ่านทุกหน้าและใช้ `parseRoster`, `validateSlipPageLayout`, `assertSlipPagePeriod`, `identifyPageSlips` และ `assertUniquePeriod` จากโค้ดเว็บจริง แสดงเฉพาะเลขลำดับเอกสาร จำนวนหน้า/สลิป และผล PASS/FAIL พร้อมเลขหน้าที่มีปัญหา ไม่มีการพิมพ์ข้อมูลเจ้าของบัญชี รายรับ หรือชื่อไฟล์ออกมา

หากได้ FAIL แม้หน้าเดียว **หยุด** ไม่อัปโหลดไฟล์นั้น ตรวจปัญหาในเครื่องที่มีสิทธิ์เท่านั้น ห้ามวางข้อความ PDF หรือข้อมูลบัญชีลง Issue/CI/Chat

## 2. ตรวจ Next.js กับ Test-only Supabase ในเครื่องเดียวกัน

ก่อนเริ่ม ให้รัน SQL แบบอ่านอย่างเดียวจาก `docs/payroll-test-readiness-readonly.sql` ผ่าน Dashboard ของ **Supabase Test เท่านั้น** และตรวจว่า `schema_ready = true`, จำนวน `slips/history/storage = 0`, รายการ `unsafe_or_missing_rpcs`, `missing_columns` และ `unsafe_tables` เป็นรายการว่าง SQL นี้รายงานเฉพาะ Metadata ไม่อ่านข้อมูลสลิปจริง หากไม่ผ่าน ให้หยุดและทบทวน Schema ก่อนส่งคำขอ API ไม่ปรับสิทธิ์ Production เพื่อให้ผ่าน

ตัวรันทดสอบจะตรวจซ้ำแบบอ่านอย่างเดียวก่อนเขียนข้อมูลว่า **ตาราง slips/upload_history และ Storage ทั้ง root/qa ว่าง** หากพบไฟล์หรือโฟลเดอร์ใด ๆ (หรืออ่านรายการ Storage ไม่สำเร็จ) จะปฏิเสธการเริ่มทดสอบทันที ห้ามลบไฟล์อื่นเพื่อทำให้ผ่าน และห้ามแสดงชื่อไฟล์/พาธที่มีข้อมูลบุคคลใน Logs

ตรวจ URL ให้ตรงกับโครงการ Test เท่านั้น: `https://dpaqvxtbpaduknergflm.supabase.co` และต้องมีสิทธิ์ใช้ **Test service-role key เท่านั้น** ห้ามใช้ Production key หรือคัดลอกรหัสลับลง Repository, GitHub Actions หรือแชท

ใน PowerShell ใช้การอ่านรหัสแบบปิดบัง (ค่าชั่วคราวอยู่ใน session เท่านั้น):

```powershell
$env:TEST_SUPABASE_RUN = "I_UNDERSTAND_TEST_ONLY"
$env:TEST_SUPABASE_URL = "https://dpaqvxtbpaduknergflm.supabase.co"
$privateKey = Read-Host "Test-only service-role key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateKey)
try {
  $env:TEST_SUPABASE_SERVICE_ROLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
try {
  node scripts/test-isolated-next-api.mjs
} finally {
  Remove-Item Env:TEST_SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TEST_SUPABASE_RUN -ErrorAction SilentlyContinue
  Remove-Item Env:TEST_SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Variable privateKey -ErrorAction SilentlyContinue
}
```

โปรแกรมทดสอบต้องแสดง PASS หลัง Cleanup เท่านั้น หาก Fail หรือ Cleanup ไม่สำเร็จให้หยุดและตรวจข้อมูล Test ด้วยผู้ดูแลที่มีสิทธิ์ ไม่รีรันซ้ำอย่างไม่มีเงื่อนไข

## 3. ตรวจ Hash ของสำเนาสำรองแบบออฟไลน์

เมื่อต้นทางได้รับการสำรองโดยผู้ดูแลที่มีสิทธิ์ ให้เตรียมโฟลเดอร์ส่วนตัวที่ประกอบด้วย **ทั้ง** ไฟล์สำรองฐานข้อมูล (รวม Schema/Privileges ตามแผน) และสำเนา Storage Objects ทั้งหมด รวมถึงไฟล์ที่ยังไม่ได้จัดหมวด ไม่ลบหรือข้ามรายการด้วยการคาดเดา

สร้าง Manifest จากไฟล์สำรองต้นทาง (เก็บ Manifest **ภายนอก** โฟลเดอร์ที่กำลังตรวจและภายนอก Git):

```powershell
node scripts/verify-private-payroll-backup.mjs create --root "D:\PrivatePayroll\backup-source" --manifest "D:\PrivatePayroll\manifest-private.json"
```

หลังคัดลอกไฟล์ไปยังตำแหน่งสำรองที่ใช้ทดสอบคืนสภาพแล้ว ให้ตรวจความครบและ SHA-256 อีกครั้ง:

```powershell
node scripts/verify-private-payroll-backup.mjs verify --root "D:\PrivatePayroll\backup-copy" --manifest "D:\PrivatePayroll\manifest-private.json"
```

ผลลัพธ์แสดงเพียง PASS/FAIL จำนวนไฟล์และขนาดรวม ไม่มีชื่อหรือเนื้อหาเอกสาร หากข้อมูลแม้หนึ่งไบต์เปลี่ยน มีไฟล์เพิ่ม/หาย หรือพบ Symbolic Link จะไม่ผ่าน และ **ไม่เขียนทับ Manifest เดิม** เพราะอาจทำให้การตรวจการเปลี่ยนแปลงผิดพลาด

**ขอบเขตหลักฐาน:** PASS ยืนยันเฉพาะความตรงกันของไบต์ในไฟล์ที่สำรอง ไม่ได้พิสูจน์ว่าฐานข้อมูล PostgreSQL Restore ได้ หรือสิทธิ์ RLS/Storage ปลอดภัย ต้องมีการทดสอบ Restore ในโครงการแยกที่ได้รับอนุญาตพร้อมตรวจ Schema, Row Count, RPC, Permissions และ Private Storage ก่อนรับรอง Gate G4

## 4. เกณฑ์ตรวจรับ

- PDF จริง: ทุกหน้าอ่านได้, ตรวจขนาด/การหมุน, A = 1 สลิป และ B = 1–2 สลิป, เดือน–ปีของทุกสลิปตรงกับค่าที่เลือก, ชื่อ–บัญชี–เลขตำแหน่งตรงทะเบียนบุคคลเดียวกัน, ไม่มีบัญชีซ้ำ
- ข้อมูลสมมติ: Next.js API ตรวจ Stage/Publish/Search/PDF, ไม่เผยแพร่ข้อมูลที่ Stage ค้าง, คืนสภาพและตรวจ 0 รายการค้าง
- ห้ามเก็บชื่อ/เลขบัญชี/เงินเดือน/PDF จริงไว้ใน Git, GitHub, CI หรือ Public Logs
- ไม่ถือว่า Production GO จนกว่าจะมีหลักฐาน Backup/Restore, Secrets, RLS/Storage, Cutover Plan และอนุมัติ Production โดยชัดเจน


## รหัสสาเหตุเมื่อ PAGE_VALIDATE ไม่ผ่าน (ไม่เปิดเผยข้อมูลบุคคล)

โปรแกรมตรวจ PDF.js จะรายงานเฉพาะ `reason` แบบรหัสคงที่เมื่อมีการปฏิเสธหน้าเอกสาร:

- `LAYOUT` — ขนาดหน้าหรือหัวเอกสารไม่ตรงกับแบบฟอร์ม A/B ที่รองรับ
- `PRINTED_PERIOD` — เดือนหรือปีที่พิมพ์ในเอกสารไม่ถูกอ่านเป็นค่าที่เลือก หรือปรากฏหลายค่า/ไม่มีค่า
- `OWNER_MATCH` — ระบุเจ้าของจากชื่อ บัญชี และเลขตำแหน่งเทียบ CSV ไม่ได้อย่างแน่นอน
- `REGION_MATCH` — จำนวนและตำแหน่งสลิปที่ตรวจยืนยันได้ไม่ตรงกับรูปแบบหน้า

**ความปลอดภัย:** รหัสนี้ไม่ได้อธิบายข้อความจริงหรือระบุบุคคลใด ๆ; อย่าส่งเนื้อหา PDF/CSV, เลขบัญชี ชื่อบุคลากรหรือรหัสผ่านไป GitHub/แชท หากเกิด FAIL ให้ส่งเฉพาะ `document`, `page`, `stage`, `reason` และจำนวนไฟล์ที่ล้มเหลวเพื่อวิเคราะห์ต่อในเครื่องที่ได้รับอนุญาต
