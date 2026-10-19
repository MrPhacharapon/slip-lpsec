# ตรวจความพร้อมค่าแวดล้อมก่อนเปิดระบบสลิปเงินเดือน (ไม่เปิดเผยรหัส)

**ใช้ในพื้นที่ส่วนตัวที่ได้รับอนุญาตเท่านั้น** ไม่รันบน GitHub Actions หรือเว็บไซต์สาธารณะ และไม่คัดลอกรหัสจริงลงเอกสาร GitHub, Issues, Chat หรือ Logs

## ขอบเขตที่ตรวจ

`scripts/check-private-release-env.mjs` ตรวจเฉพาะค่าที่มีอยู่ใน environment ของกระบวนการ ณ เวลารัน โดยไม่เชื่อมต่อฐานข้อมูลและไม่พิมพ์ค่าตั้งต้นออกมา

- `PAYROLL_RELEASE_TARGET`: ต้องเป็น `production` หรือ `test`
- `SUPABASE_URL`: ต้องตรงกับโครงการเป้าหมายที่อนุมัติ ไม่อนุญาตให้ใช้ URL Test แทน Production
- `SUPABASE_SERVICE_ROLE_KEY`: ต้องมีค่าเฉพาะฝั่งเซิร์ฟเวอร์ ห้ามเติม `NEXT_PUBLIC_`
- `NEXT_PUBLIC_SUPABASE_URL`: หากมีต้องตรงกับ `SUPABASE_URL` เพื่อป้องกันสลับโครงการ
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `PAYROLL_RATE_LIMIT_SECRET`: ต้องมีความยาวขั้นต่ำและไม่ใช้ซ้ำ
- Production ต้องตั้งค่า `CRON_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` และ `LINE_GROUP_ID` สำหรับเส้นทาง Cron และ LINE ที่มีอยู่แล้วในระบบ และไม่ใช้ค่าลับซ้ำกัน
- Test ต้องใช้ `STAFF_DIRECTORY_DISABLED=true` เพื่อไม่ดึงทะเบียนบุคลากรจริง ส่วน Production ให้กำหนดตาม `PAYROLL_ROSTER_MODE`: `server_sheet` ต้องเปิดการอ่านทะเบียน และ `local_csv` ต้องปิดการอ่านทะเบียน
- `APP_ORIGIN`: ต้องเป็น HTTPS Origin ของเว็บไซต์ที่ใช้งาน (ไม่ใช่ HTTP หรือ URL ที่มี path/credential)
- `PAYROLL_ROSTER_MODE`: Production **ต้องระบุค่าเองอย่างชัดเจน** เป็น `server_sheet` หรือ `local_csv` ไม่ปล่อยให้ใช้ค่าเริ่มต้นเงียบ ๆ; ผู้ดูแลยืนยันวันที่ 19 ต.ค. 2569 ให้ Production ใช้ **`server_sheet`** เพื่อใช้ Google Sheets เดิมเหมือนระบบก่อนปรับปรุง
- `STAFF_SHEET_ID`: ต้องระบุเมื่อใช้ `server_sheet` ใน Production; Test และ Production `local_csv` ไม่บังคับ แต่ถ้าระบุยังต้องเป็น ID ที่มีรูปแบบถูกต้อง
- `STAFF_DIRECTORY_DISABLED`: Production `server_sheet` ต้องระบุค่า **`false`** ชัดเจน (ห้ามเว้นว่าง); Test ต้องเป็น **`true`** เพื่อไม่เชื่อมทะเบียนจริง
- `STAFF_SHEET_ACCESS_MODE`: Production `server_sheet` ต้องเป็น **`service_account`** สำหรับ Google Sheets API แบบอ่านอย่างเดียว ไม่มี fallback ไป Public CSV
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` และ `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`: ต้องเป็น Service Account ของ Google Cloud ที่ได้รับสิทธิ์ Reader สำหรับ Google Sheets ไฟล์เดิม โดยเก็บ Secret เฉพาะฝั่งเซิร์ฟเวอร์; ห้ามใช้ `NEXT_PUBLIC_`

## วิธีตรวจโดยไม่เปิดเผย Secret

บนเครื่องที่ได้รับสิทธิ์และตั้งค่า Environment Variables ผ่านช่องทางปลอดภัยแล้ว ใช้คำสั่ง:

```powershell
node scripts/check-private-release-env.mjs
```

คำสั่งจะแสดงเฉพาะ JSON `result=PASS` หรือ `result=NO_GO` พร้อม **ชื่อคีย์** ที่ขาด/ผิดรูปแบบโดยไม่มีค่าจริง ตัวอย่าง:

```json
{"result":"NO_GO","checks":"release-environment","missingOrInvalid":["SUPABASE_SERVICE_ROLE_KEY","APP_ORIGIN"]}
```

**ผล PASS ไม่ได้พิสูจน์ว่าคีย์ใช้ได้จริง หรือยืนยัน Backup/Restore, RLS, Storage และ API ที่กำลังรัน** ต้องผ่าน Gate ตรวจรับอื่นด้วยเสมอ ห้ามใช้ผลนี้เป็นคำอนุมัติ Merge/Deploy

## ผลตรวจรายการคีย์จาก Vercel (19 ตุลาคม 2569)

ตรวจ Metadata ล่าสุดโดย **ไม่ถอดรหัสค่า** พบ 11 ชื่อ: ตัวแปรเดิม 4 รายการ, ตัวแปร Production-only 6 รายการที่ตั้งไว้ก่อนหน้า และ `STAFF_SHEET_ACCESS_MODE=service_account` เพิ่มอีก 1 รายการ. **ยังไม่พบ** Service Account Email/Private Key, Supabase server service-role key, Admin/Session/Rate-limit secrets, Cron secret และ LINE webhook secret. การมีชื่อคีย์ไม่ได้พิสูจน์ว่าค่าใช้งานได้จริง

**ห้ามตั้งค่าปลอมหรือใช้ Test Credentials แทน Production** เพื่อให้สคริปต์ PASS ผู้ดูแลต้องตั้งค่าผ่านหน้าจอ Vercel/ช่องทาง Secret Manager ที่ได้รับอนุญาตเท่านั้น

## ขอบเขตที่ผู้ใช้ยืนยัน

หน้าเว็บบุคลากร **ใช้เลขบัญชี 10 หลักค้นหาสลิปตามเดิม** ไม่เพิ่ม OTP การล็อกอินบุคลากร หรือการยืนยันเจ้าของบัญชีในเวอร์ชันนี้ (ความเสี่ยงที่เหลือบันทึกไว้ในแผน Production Cutover)

**ผลที่ผู้ดูแลยืนยันแล้ว:** G2 ผ่านการเชื่อม Next.js → Supabase Test ส่วนตัว, G3 ผ่าน PDF.js+CSV จริง 10 เดือน / 338 หน้า / 376 สลิป; G4 ผู้ดูแลเลือกข้าม Backup/Restore ทั้ง DB และ PDF (WAIVED ไม่ใช่ PASS). โครงการยัง **NO-GO** เนื่องจาก G5–G8 ยังไม่ผ่าน และไม่มีจุดกู้คืน PostgreSQL ที่ตรวจสอบแล้ว

แนวทางปฏิบัติสำหรับ Google Sheets เดิมและตัวแปรที่ต้องตั้งเฉพาะ Production: [G5 Google Sheets operator setup](./g5-server-sheet-operator.md)
