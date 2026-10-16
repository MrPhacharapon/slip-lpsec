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
- `PAYROLL_ROSTER_MODE`: `server_sheet` (ค่าเริ่มต้น) หรือ `local_csv` (นำเข้า CSV ส่วนตัวทุกครั้งที่ Admin อัปโหลด); หากใช้ `local_csv` จะไม่บังคับ `STAFF_SHEET_ID` แต่ตำแหน่งที่เคยอ่านจาก Sheet อาจไม่แสดง
- `STAFF_SHEET_ID`: ต้องระบุเมื่อใช้ `server_sheet` ใน Production; Test และ Production `local_csv` ไม่บังคับ แต่ถ้าระบุยังต้องเป็น ID ที่มีรูปแบบถูกต้อง

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

## ผลตรวจรายการคีย์จาก Vercel (16 ตุลาคม 2569)

อ่านเฉพาะ Metadata ของ Production Environment โดย **ไม่ถอดรหัสค่า** พบเพียง `LINE_GROUP_ID`, `LINE_CHANNEL_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` จึงยังไม่มีหลักฐานการตั้งค่า 7 คีย์ที่จำเป็นตามรายการด้านบน

**ห้ามตั้งค่าปลอมหรือใช้ Test Credentials แทน Production** เพื่อให้สคริปต์ PASS ผู้ดูแลต้องตั้งค่าผ่านหน้าจอ Vercel/ช่องทาง Secret Manager ที่ได้รับอนุญาตเท่านั้น

## ขอบเขตที่ผู้ใช้ยืนยัน

หน้าเว็บบุคลากร **ใช้เลขบัญชี 10 หลักค้นหาสลิปตามเดิม** ไม่เพิ่ม OTP การล็อกอินบุคลากร หรือการยืนยันเจ้าของบัญชีในเวอร์ชันนี้ (ความเสี่ยงที่เหลือบันทึกไว้ในแผน Production Cutover)

โครงการยัง **NO-GO** จนกว่าทดสอบ Next.js → Supabase Test แบบ Full-stack, ตรวจ PDF.js กับไฟล์จริงในเครื่องส่วนตัว, ทดสอบ Restore จาก Production Backup และได้รับอนุมัติเปลี่ยน Production
