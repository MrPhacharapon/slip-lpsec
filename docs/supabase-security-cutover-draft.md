# ร่างแผนป้องกันข้อมูลสลิปเงินเดือน — ไม่ได้ดำเนินการกับ Production

**สถานะ:** พัฒนาเฉพาะ Branch `fix/payroll-pdf-validation-no-deploy`; ยังไม่ได้ Merge, Deploy หรือใช้คำสั่ง SQL นี้จริง

## วัตถุประสงค์และขอบเขตที่ผู้ใช้อนุมัติ

- คงหน้าเว็บครู: กรอกเลขบัญชี เลือกช่วงเวลา ค้นหาและเปิด PDF เช่นเดิม
- คงหน้า Admin: ใส่รหัสผ่านในหน้าต่างเดิม ไม่เพิ่มระบบบัญชีผู้ใช้หรือ OTP
- ห้ามให้เบราว์เซอร์ติดต่อ Supabase Data API ด้วยสิทธิ์สาธารณะโดยตรง
- ให้ API ฝั่ง Next.js ตรวจข้อมูลก่อนเรียก Supabase ผ่าน **service-role key ที่เก็บเป็นค่าแวดล้อมฝั่งเซิร์ฟเวอร์เท่านั้น**
- ต้องชี้แจงข้อจำกัด: ผู้ที่ทราบเลขบัญชีผู้อื่นยังสามารถใช้วิธีค้นหาแบบเดิมเพื่อเปิดสลิปได้ (ไม่ได้พิสูจน์เจ้าของเลขบัญชี)

## ค่าแวดล้อมใหม่ที่ต้องเตรียมใน Vercel (ยังไม่ได้ตั้งค่า)

| ค่าที่ต้องกำหนด | ความหมาย | ข้อกำหนด |
|---|---|---|
| `SUPABASE_URL` | URL ของโครงการ Supabase | เก็บฝั่งเซิร์ฟเวอร์ |
| `SUPABASE_SERVICE_ROLE_KEY` | กุญแจสิทธิ์ฝั่งเซิร์ฟเวอร์ | ห้ามตั้ง `NEXT_PUBLIC_` ห้ามแสดงใน log หรือส่งสู่เบราว์เซอร์ |
| `ADMIN_PASSWORD` | รหัสผ่าน Admin **ใหม่** | อย่างน้อย 12 ตัวอักษร ต้องไม่ใช้ค่าจากชีต Settings ที่เคยแชร์ |
| `ADMIN_SESSION_SECRET` | กุญแจลงลายมือชื่อคุกกี้ | สุ่มความยาวอย่างน้อย 32 ตัวอักษร ห้ามใช้ซ้ำกับ Admin password |
| `APP_ORIGIN` | ต้นทางเว็บที่เชื่อถือได้ | ระบุ https://โดเมนเว็บจริงที่ใช้ เป็นค่าคงที่ |
| `CRON_SECRET` | รหัสยืนยันงาน keep-alive | ห้ามเปิดเผย ฝั่ง Vercel Cron ส่ง Authorization แบบ Bearer |

**ห้ามนำค่าจริงทุกชนิดไป GitHub, GitHub Actions, ไฟล์โค้ด, หรือเอกสาร.** CI ใช้ค่าทดสอบเท่านั้น

## สิ่งที่เปลี่ยนในแอป

- `/api/auth`: ตรวจ Admin password จาก env แทนชีตสาธารณะ และออกคุกกี้ HttpOnly, SameSite=Strict, อายุ 4 ชั่วโมง
- `/api/admin/*`: ตรวจคุกกี้และ Origin สำหรับการเปลี่ยนข้อมูล
- `/api/payroll/periods`: แสดงเฉพาะเดือน/ปีที่มีประวัติการเผยแพร่
- `/api/payroll/search`: ส่งข้อมูลรายการตามเลขบัญชี 10 หลัก **ไม่ส่ง PDF ทุกเดือนมาพร้อมกัน**
- `/api/payroll/pdf`: ส่ง PDF ฉบับเดียวตามเลขบัญชี+เดือน+ปีจากเดือนที่เผยแพร่แล้ว; ปิด Cache
- การอัปโหลดของผู้ดูแล: ส่งสลิปเป็นชุดเล็กและบันทึกประวัติการเผยแพร่ตอนท้าย หากขัดข้องระหว่างทาง จะไม่เผยแพร่เดือนนั้น (แต่มี staged rows เหลือ ซึ่งต้องตรวจและกู้คืนโดยผู้ดูแล)
- `/api/admin/storage`: เปิดไฟล์ต้นฉบับเก่าผ่านสิทธิ์ Admin โดยไม่สร้าง public URL

## ต้องเปลี่ยน Supabase พร้อม Deploy: SQL เสนอให้ตรวจรับ **ก่อนรัน** เท่านั้น

```sql
BEGIN;
ALTER TABLE public.slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slips FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.upload_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.slips TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.upload_history TO service_role;
COMMIT;
```

ไม่ต้องสร้าง policy SELECT สำหรับ `anon` เพราะหน้าเว็บเปลี่ยนมาเรียก API ของ Next.js แล้ว (หากเปิดเผยข้อมูลโดยตรงจะกลับมามีช่องโหว่) ก่อนใช้ SQL ต้องตรวจ grants/policies และบริการอื่นที่อาศัยตารางเดิมให้ครบ และทดสอบบน Supabase แยกจริงก่อน

Storage: เปลี่ยน bucket `slips` เป็น private และยกเลิก policy `storage.objects` ที่อนุญาต `public` SELECT/INSERT/UPDATE/DELETE โดยใช้ Supabase Dashboard/API ด้วยคำสั่งที่ผ่านการตรวจรับ แนะนำปิดการเผยแพร่ไฟล์เดิมและตรวจ CDN cache ด้วย ก่อนทำต้องตรวจไฟล์ที่ยังถูกอ้างอิงในประวัติ อย่า delete Storage objects โดยเดา

ปัจจุบัน Supabase Advisor ยังแจ้ง RLS Disabled on Public และ Bucket `slips` เป็น public; **ยังไม่มีการแก้ไขจริง**

## เหตุผลที่ห้าม Deploy โค้ดเพียงอย่างเดียว

1. หาก Deploy แต่ไม่ล็อก Supabase: ผู้รู้ URL/anon key เดิมยังเรียกฐานข้อมูลสลิปทั้งหมดได้
2. หากล็อก Supabase ก่อน Deploy: หน้าเว็บ Production เดิมจะอ่าน/เขียนไม่ได้
3. จึงต้องทำการตรวจรับระบบเซิร์ฟเวอร์และแผนเปลี่ยนผ่านอย่างประสานกัน ขณะยังไม่อนุมัติ Deploy ห้ามแก้ RLS/Bucket
4. รหัส Admin เดิมอยู่ในชีต Settings ที่แชร์ผ่านลิงก์ การนำขึ้นใหม่ต้องใช้รหัสใหม่ใน env และจัดการข้อมูลรหัสเดิมออกจากชีตตามแผนที่อนุมัติ

## ประเด็นที่ยังต้องตรวจเพิ่ม

- มาตรการจำกัดจำนวนคำขอค้นหาและลองรหัสผ่านระดับ Edge/WAF (การนับในหน่วยความจำเซิร์ฟเวอร์ไม่เพียงพอสำหรับ serverless)
- เส้นทาง Admin แบบ staged upload และการบันทึกประวัติยังไม่ใช่ transaction เดียวกัน; ต้องทดสอบ recovery
- Browser E2E จำลอง Supabase ด้วย localhost, ไม่ใช่การทดสอบบนฐานข้อมูลสำรองจริง
- Rate limit และการเข้าถึงจากบุคคลที่รู้บัญชีผู้อื่นยังเป็นความเสี่ยงคงเหลือภายใต้ UX ที่ผู้ใช้ระบุ
- ก่อน Production ต้องสำรองข้อมูลจริง ยืนยันที่มาของไฟล์เก่า ตรวจการคืนสภาพ และขออนุมัติ Merge/Deploy/เปลี่ยน Database แยกต่างหาก

แหล่งอ้างอิง Supabase: https://supabase.com/docs/guides/api/securing-your-api
