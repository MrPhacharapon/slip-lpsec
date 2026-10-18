# slip-lpsec — เกณฑ์ตรวจรับ
ปรับปรุง: 17 ตุลาคม 2569

| รายการ | ผลที่ต้องผ่าน | กรณีปฏิเสธ / ขอบเขต |
|---|---|---|
| ค้นหาโดยครู | บัญชี 10 หลัก, เห็นเฉพาะเดือน Publish และ PDF ของบัญชีที่ค้นหา | ไม่มี OTP, ไม่พบต้องไม่รั่วข้อมูล, จำกัดคำขอและ Fail Closed |
| ขนาด Public JSON | Search และ PDF รับ Request JSON ไม่เกิน 1,024 ไบต์, อ่านแบบ Streaming และตรวจ Content-Length | Body เกินขนาด/Chunked เกินขนาดตอบ 413; JSON ผิด/UTF-8 ไม่ถูกต้องตอบ 400 โดยไม่แตะ DB |
| Admin | Password, Session Cookie ลงลายเซ็น, Origin Validation | ไม่ล็อกอิน, ข้าม Origin, รหัสผิดจำนวนมากต้องถูกปฏิเสธ |
| ทะเบียน | CSV ส่วนตัวในเบราว์เซอร์หรือทะเบียนผ่าน Admin API; จับคู่ 3 ฟิลด์ | ชื่อผิด, บัญชีผิด, เลขตำแหน่งผิด, บัญชีซ้ำ, CSV ต้นฉบับไม่ขึ้น Server |
| PDF A | หนึ่งสลิปหนึ่งหน้าและระบุตัวตนได้แน่นอน | หัวไม่ครบ, ขนาด/มุมผิด, เจ้าของไม่ตรง |
| PDF B | สองสลิป/หน้า และหนึ่งสลิปหน้าสุดท้ายเมื่อจำนวนคี่ | คนที่สองระบุไม่ได้, หัวเกิน, สลิปเดี่ยวตรงกลาง, A/B ปนกัน |
| เดือน–ปีที่พิมพ์ | ทุกสลิปตรงกับเดือน–ปีที่เลือก แม้ PDF.js แยกอักขระ | เดือนผิด, ปีผิด, ฟิลด์หาย/ซ้ำ, ครึ่งล่างของ B ต่างเดือน |
| PDF ที่เก็บ | PDF ใหม่เป็นภาพหน้าเดียวของเจ้าของที่ผ่านการตรวจ | ห้ามมีข้อความหรือ Resource ของอีกคน |
| Stage/Publish | นับจำนวน Acknowledgement ตรง, Publish Atomic, ประวัติถูกต้อง | Partial Stage ไม่แสดงต่อครู; ปฏิเสธการ Publish ซ้ำ/จำนวนไม่ตรง |
| ลบ/กู้ข้อมูล | Preview, Snapshot, สำรองและยืนยันตามเงื่อนไข | ห้ามลบที่มีไฟล์ต้นฉบับไม่ได้ป้องกัน, ห้ามลบซ้ำเพราะรีเฟรชล้มเหลว |
| LINE | แจ้งหนึ่งครั้งหลัง Publish เมื่อเปิดตัวเลือก; Webhook ที่ลงลายเซ็นถูกต้องประมวลผลทุก Event ใน Batch และ Reply เฉพาะเหตุการณ์ Group ที่มี Token | ไม่แจ้งเมื่อปิด, ปฏิเสธลายเซ็นปลอม, ข้ามข้อมูล Event ไม่ครบ, ไม่ Reply Token ซ้ำใน Batch, จำกัด Raw Body ไม่เกิน 1,000,000 ไบต์ก่อนตรวจ HMAC, Timeout ไม่ย้อนผล Publish |
| สภาพแวดล้อม | Test RLS+Private Storage; ไม่มี Public Write/Read | Prod ต้องผ่านการตรวจสิทธิ์และ Backup/Restore ก่อน Cutover |
| ขนาดงาน | ทดสอบ B 100 สลิป / 50 หน้า ด้วยข้อมูลสมมติ | ไม่ใช้เป็นหลักฐานประสิทธิภาพ Production |

## ชั้นหลักฐาน
1. **Automated CI**: Unit, TypeScript, Full ESLint, Build, Synthetic PDF.js, Mock Browser E2E — ต้องผ่านตรงกับ SHA ล่าสุด และ Aggregate `validate` ต้องผ่าน
2. **Supabase Test SQL**: Metadata สิทธิ์/Index/RPC และ Transaction สมมติที่ Rollback พร้อมตรวจเหลือ 0 — ยังไม่ใช่ Full-stack REST
3. **Private Test-only Integration**: Next.js API จริงกับ Supabase Test จริง โดยข้อมูลสมมติและ Test-only Credentials, ตรวจ Cleanup 0
4. **Private Real PDF.js**: ไฟล์ต้นฉบับและทะเบียนจริงเก็บในเครื่องส่วนตัวของผู้มีสิทธิ์ ตรวจทุกหน้า ทุกเดือนและทุกรูปแบบ
5. **Database + Storage Restore**: สำรองครบและกู้คืนในสภาพแวดล้อมแยกจริง ตรวจ Hash, Row Count, Privileges, RLS และการใช้งานไฟล์ — Hash Copy อย่างเดียวไม่พอ
6. **Production**: G1–G8 จาก `docs/payroll-production-go-no-go-2026-10-16.md` ต้องผ่านทั้งหมดและมีการอนุมัติแยก

หาก Gate บังคับข้อใดยังไม่ผ่านหรือไม่มีหลักฐาน ให้คง **NO-GO**; CI ผ่านไม่ใช่การอนุมัติ Production.
