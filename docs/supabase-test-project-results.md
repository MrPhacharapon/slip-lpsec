# Supabase โครงการทดสอบ sliplpsec-test — ผลตรวจรับเบื้องต้น

ตรวจ ณ 15 ตุลาคม 2569 • **โครงการทดสอบเท่านั้น** (project ref `dpaqvxtbpaduknergflm`, Singapore, Free) • ไม่ใช่ผลการตรวจรับ Production

## การแยกโครงการและข้อมูล

- สร้าง `sliplpsec-test` ภายใน Organization เดิม: Supabase ยืนยันค่าใช้จ่ายสร้างโครงการ `$0/เดือน`.
- **ไม่ใช้หรือคัดลอกสลิปเงินจริงและบัญชีจริง**; ไม่มีการแตะ Production.
- ตาราง `public.slips` และ `public.upload_history` มีคอลัมน์ที่แอปต้องใช้, เปิด RLS, และตัดสิทธิ์ `anon` กับ `authenticated` ทั้งการอ่านและเขียน.
- Bucket `slips` เป็น **Private**, ไม่มี `storage.objects` policy เปิดสาธารณะ.
- มี unique index สำหรับ `(bank_account, month, year)` และสำหรับ `(month,year)` ในประวัติการอัปโหลด **เฉพาะโครงการทดสอบ**.

## ผลทดสอบกับ PostgreSQL ของโครงการทดสอบจริง

| กรณี | ผลที่สังเกต |
|---|---|
| `SET LOCAL ROLE anon; SELECT ... FROM public.slips` | ถูกปฏิเสธด้วย 42501 (permission denied) |
| `SET LOCAL ROLE anon; INSERT ... INTO public.slips` | ถูกปฏิเสธด้วย 42501 |
| `SET LOCAL ROLE authenticated; SELECT ... FROM public.upload_history` | ถูกปฏิเสธด้วย 42501 |
| `SET LOCAL ROLE service_role; SELECT ... FROM public.slips` | สำเร็จ |
| `SET LOCAL ROLE anon; SELECT count(*) FROM storage.objects WHERE bucket_id='slips'` | 0 รายการที่มองเห็น (bucket ยังไม่มีไฟล์) |
| เพิ่มแถวสมมติ 2 รายการก่อนมี `upload_history` | มี staged rows 2, published 0, discoverable 0 |
| เพิ่มข้อมูล `bank_account` ซ้ำในเดือนเดียวกัน | PostgreSQL ปฏิเสธ 23505 unique constraint |
| เพิ่ม `upload_history` ของเดือนสมมติ | มีรายการที่ค้นผ่านเงื่อนไข published 2 |
| ลบข้อมูลสมมติทั้งหมด | `slips=0`, `upload_history=0` |

**ข้อจำกัดการทดสอบ:** ตัวอย่างที่ใส่ในฐานข้อมูลจริงเป็นข้อความสมมติที่มีลักษณะขึ้นต้นด้วย `%PDF-` แต่ไม่ได้เป็นเอกสาร PDF จริง จึงไม่ได้พิสูจน์การเปิด PDF.js/Browser กับฐานข้อมูลใหม่ การทดสอบ Browser E2E ที่ผ่านมาใช้ PDF สมมติจริงแต่จำลอง Supabase ด้วย localhost ไม่ใช่ Supabase โครงการทดสอบนี้

## เงื่อนไขสำหรับการทดสอบ Next.js → Supabase จริงครั้งถัดไป

1. รัน Next.js แบบส่วนตัวโดยตั้ง `SUPABASE_URL=https://dpaqvxtbpaduknergflm.supabase.co` (ต้องชี้โครงการทดสอบเท่านั้น)
2. ตั้ง `SUPABASE_SERVICE_ROLE_KEY` ของ **โครงการทดสอบเท่านั้น** ใน Secret/Environment ฝั่งเซิร์ฟเวอร์ **ห้ามส่งกุญแจในแชท, GitHub, logs หรือ `NEXT_PUBLIC_`**. เครื่องมือที่เชื่อมในแชทนี้สามารถอ่านได้เฉพาะ publishable key; ไม่สามารถอ่าน secret/service-role key ได้.
3. ตั้ง `STAFF_DIRECTORY_DISABLED=true` เพื่อไม่อ่าน Google Sheets จริง, ตั้ง `APP_ORIGIN`, `ADMIN_PASSWORD` สมมติ, และ `ADMIN_SESSION_SECRET` สมมติที่ปลอดภัยพอสำหรับการทดสอบ (ไม่ใช้รหัส Production)
4. ทดสอบ PDF สมมติที่ถูกต้อง รูปแบบ A/B จำนวนคี่, เซสชัน Admin, ปฏิเสธผู้ไม่มีสิทธิ์, และ staged → publish → staff lookup → PDF response
5. ยืนยันข้อมูลจำลองลบได้หมดหลังทดสอบ, รัน Security Advisors อีกครั้ง

**สคริปต์ทดสอบจริงที่เตรียมไว้:** `scripts/test-isolated-supabase-live.mjs` ใช้เฉพาะ `TEST_SUPABASE_URL` ที่ตรงกับโครงการทดสอบนี้และ `TEST_SUPABASE_SERVICE_ROLE_KEY` ฝั่งเครื่องส่วนตัว พร้อม `TEST_SUPABASE_RUN=I_UNDERSTAND_TEST_ONLY`; สร้าง PDF สมมติจริงด้วย pdf-lib, ทดสอบ stage, duplicate, publish, read-back, Private Storage แล้วลบข้อมูลจำลองใน `finally`. **ยังไม่ได้รันสคริปต์นี้** เพราะสภาพแวดล้อมปัจจุบันไม่มี test service-role secret ผ่านเครื่องมือที่ปลอดภัย และไม่มีการเชื่อมต่อเครือข่ายจาก container. ไม่ควรใส่ secret ใน GitHub Actions หรือในแชท.

**ใหม่ — การทดสอบ Next.js → Supabase จริง:** เตรียม `scripts/test-isolated-next-api.mjs` ซึ่งบังคับ URL เป็น `https://dpaqvxtbpaduknergflm.supabase.co`, สร้างเว็บเซิร์ฟเวอร์ Next.js ภายในเครื่องเฉพาะ `127.0.0.1:3137` โดยใช้ Admin password/session และกุญแจจำกัดคำขอที่สุ่มเพื่อทดสอบเท่านั้น ไม่แตะค่าลับ Production, ปิดทะเบียน Google Sheets จริง, และใช้เฉพาะ PDF/ชื่อ/บัญชีสมมติ

สคริปต์นี้เรียก **API เดียวกับแอปจริง**: Admin login → preflight → stage → ตรวจไม่แสดงก่อนเผยแพร่ → preview/ล้าง staged → stage → ตรวจเลขบัญชีซ้ำและจำนวนผิด → publish → ค้นหาเลขบัญชี → เปิด PDF บุคคลเดียว → ตรวจ Private Storage → ตรวจความจำเป็นต้องยืนยันสำรองก่อนลบ พร้อมกู้คืน/ล้างข้อมูลทดสอบผ่าน Admin RPC ที่ตรวจ snapshot ใน `finally`. หากข้อมูลเปลี่ยนหรือเกินขอบเขต จะหยุดโดยไม่ลบข้อมูลที่ไม่ใช่ของชุดทดสอบ และแจ้งให้ตรวจด้วยผู้ดูแล

**การรันด้วยเครื่องส่วนตัว (ยังไม่ได้รันจริง):** ต้องติดตั้ง Node.js 22+ และ `npm ci`, ใช้ค่า Environment `TEST_SUPABASE_RUN=I_UNDERSTAND_TEST_ONLY`, `TEST_SUPABASE_URL=https://dpaqvxtbpaduknergflm.supabase.co`, `TEST_SUPABASE_SERVICE_ROLE_KEY` ของ **โครงการทดสอบเท่านั้น** ซึ่งตั้งไว้ในเครื่องโดยตรง ไม่ส่งกุญแจหรือค่า Environment ทั้งหมดเข้า ChatGPT, GitHub, commit, CI logs หรือภาพหน้าจอ จากนั้นใช้ `node scripts/test-isolated-next-api.mjs`. สามารถกำหนด `TEST_SUPABASE_PUBLISHABLE_KEY` ของโครงการทดสอบเพื่อทดสอบการปฏิเสธ Storage สำหรับผู้ใช้สาธารณะได้

`scripts/test-isolated-supabase-live.mjs` รุ่นแรกทดสอบฐานข้อมูล/Storage โดยตรงเท่านั้นและไม่ใช้ API ใหม่ครบวงจร ให้ใช้สคริปต์ `test-isolated-next-api.mjs` สำหรับการตรวจรับแอปจริงแทน

**ยังไม่ดำเนินการ:** การสร้างรหัส secret ของโครงการทดสอบในสถานที่ทำงานสำหรับ Next.js, การ Deploy ไป Vercel, การแก้ไข RLS/Storage ใน Production, การ Merge เข้า main

## ข้อพึงระวัง

- การไม่เผยแพร่แถว staged ใน Search API เป็นตรรกะของ **แอป** (`upload_history` เป็นเงื่อนไข) ไม่ใช่ข้อบังคับ RLS ของ `service_role` ซึ่งอ่านทุกแถวได้; ต้องทดสอบ API จริงต่อ.
- บัญชีธนาคารยังเป็นข้อมูลค้นหา ไม่ใช่หลักฐานพิสูจน์ตัวตน; ผู้ที่รู้เลขบัญชีผู้อื่นยังมีความเสี่ยงเข้าถึงสลิป.
- เมื่อใช้งาน Production จำเป็นต้องเปลี่ยนค่าตั้งต้นแยกกันโดยไม่ปิดระบบเดิมก่อนพร้อม; ห้ามเปิดสิทธิ์ anon ใน Production เพื่อให้โค้ดเดิมทำงานต่อ.

อ้างอิงแนวทาง [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) และ [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
