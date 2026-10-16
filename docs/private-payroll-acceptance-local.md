# ตรวจรับสลิปจริงในเครื่องส่วนตัว (ไม่อัปโหลดข้อมูลจริง)

**ขอบเขต:** เฉพาะไฟล์ PDF ที่ผู้ดูแลมีสิทธิ์ใช้ และโครงการ Supabase **sliplpsec-test** เท่านั้น ไม่ใช่คำอนุญาตให้ Merge, Deploy หรือแก้ Supabase Production

## สิ่งที่แยกจากกันโดยเจตนา

1. ตรวจ PDF.js บนคอมพิวเตอร์ส่วนตัวด้วยสลิปจริงและทะเบียนที่ส่งออกมาเป็น CSV: **อ่านอย่างเดียว** ไม่ติดต่อ Supabase และไม่บันทึกไฟล์ PDF ใหม่
2. ตรวจ Next.js API → Supabase Test ด้วยข้อมูล **สมมติที่สคริปต์สร้าง**: ไม่ใช้สลิปจริง ไม่เปิด Public Preview และต้องยืนยันว่าลบข้อมูล Test กลับหมดก่อนแสดง PASS
3. การตรวจ Backup/Restore และ Production Migration เป็นขั้นตอนอื่นที่ต้องมีการอนุมัติแยกต่างหาก

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
  --pdf "D:\PrivatePayroll\January.pdf" `
  --pdf "D:\PrivatePayroll\February.pdf"
```

เพิ่ม `--pdf` ได้ตามจำนวนไฟล์ที่ต้องการตรวจ (ไม่เกิน 24 ไฟล์ต่อคำสั่ง) สคริปต์ใช้ PDF.js อ่านทุกหน้าและใช้ `parseRoster`, `validateSlipPageLayout`, `identifyPageSlips` และ `assertUniquePeriod` จากโค้ดเว็บจริง แสดงเฉพาะเลขลำดับเอกสาร จำนวนหน้า/สลิป และผล PASS/FAIL พร้อมเลขหน้าที่มีปัญหา ไม่มีการพิมพ์ข้อมูลเจ้าของบัญชี รายรับ หรือชื่อไฟล์ออกมา

หากได้ FAIL แม้หน้าเดียว **หยุด** ไม่อัปโหลดไฟล์นั้น ตรวจปัญหาในเครื่องที่มีสิทธิ์เท่านั้น ห้ามวางข้อความ PDF หรือข้อมูลบัญชีลง Issue/CI/Chat

## 2. ตรวจ Next.js กับ Test-only Supabase ในเครื่องเดียวกัน

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

## 3. เกณฑ์ตรวจรับ

- PDF จริง: ทุกหน้าอ่านได้, ตรวจขนาด/การหมุน, A = 1 สลิป และ B = 1–2 สลิป, ชื่อ–บัญชี–เลขตำแหน่งตรงทะเบียนบุคคลเดียวกัน, ไม่มีบัญชีซ้ำ
- ข้อมูลสมมติ: Next.js API ตรวจ Stage/Publish/Search/PDF, ไม่เผยแพร่ข้อมูลที่ Stage ค้าง, คืนสภาพและตรวจ 0 รายการค้าง
- ห้ามเก็บชื่อ/เลขบัญชี/เงินเดือน/PDF จริงไว้ใน Git, GitHub, CI หรือ Public Logs
- ไม่ถือว่า Production GO จนกว่าจะมีหลักฐาน Backup/Restore, Secrets, RLS/Storage, Cutover Plan และอนุมัติ Production โดยชัดเจน
