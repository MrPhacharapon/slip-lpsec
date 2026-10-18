# slip-lpsec — PROJECT_STATUS
สถานะที่ตรวจเมื่อ 18 ตุลาคม 2569; **Snapshot ไม่ใช่การติดตามแบบ Real-time**

## หลักฐานก่อนชุดแก้ไขล่าสุด
- Repository: `MrPhacharapon/slip-lpsec`
- Branch ทดสอบ: `fix/payroll-pdf-validation-no-deploy`; ล่าสุดที่ **ยืนยัน CI ผ่าน**: `ec87ee5f3b018ef7c31d24acc4bcbfe3c05ef0c0`
- GitHub Actions: [Run #39141567170](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39141567170) — **SUCCESS สำหรับ SHA เดิม**; Unit 120/120, PDF.js สมมติ 5/5, TypeScript, ESLint, Build และ Browser Mock E2E ผ่าน
- Production Main: `fdced74510f57ab83a758642f2edba08dad0b316`; Vercel Production READY ที่ Commit เดิม ไม่ได้ Deploy จาก Branch นี้
- Supabase Test: `slips=0`, `upload_history=0`, `storage.objects=0`, `rate_limits=0`; bucket slips เป็น Private
- Supabase Production: `slips=338`, `upload_history=9`, `storage.objects=12`; RLS ปิด 2 ตารางและ Storage slips เป็น Public
- Vercel Environment Metadata: มีเพียง 4 keys (2 คีย์ LINE และ 2 คีย์ Supabase แบบ Public); ยังไม่พร้อมสำหรับ Server-only App ใหม่
- ข้อมูลนี้อ่านเฉพาะจำนวนและสถานะ ไม่เรียก PDF จริง รายชื่อ เลขบัญชีหรือ Key

## งานที่ตรวจรับและ Draft PR
- Draft Pull Request: [#1](https://github.com/MrPhacharapon/slip-lpsec/pull/1), Head `ec87ee5f3b018ef7c31d24acc4bcbfe3c05ef0c0`, Base `fdced74510f57ab83a758642f2edba08dad0b316`
- Source features ผ่าน Synthetic Unit 112/112, PDF.js 5/5, Browser E2E, TypeScript, ESLint, Build และ Aggregate `validate` ตาม CI ที่อ้างอิงด้านบน
- SQL Metadata Read-only เทียบ Supabase Test/Production: Test `schema_ready=true`; Production `schema_ready=false`. Production ขาด RPC 8 รายการ, คอลัมน์ 4 รายการ (รวมตาราง rate limits ที่ยังไม่มี), Unique Index 2 รายการ, ยังมี Public Grants, RLS ปิด และ Public Storage
- ไฟล์ PDF ต้นฉบับบางเดือนมีรายการใน Library แต่ **ไม่ได้รับ raw bytes เพื่อรัน PDF.js ในพื้นที่ที่อนุญาต** จึงไม่สามารถถือว่า G3 ผ่าน
- ชุดเอกสารปัจจุบันเพิ่ม `docs/RELEASE_OPERATOR_HANDOFF.md` ให้ลำดับตรวจรับส่วนตัวและแนวทาง Cutover แบบไม่เปิดเผยข้อมูลจริง
- CI ล่าสุดของ `4decbc5` ผ่าน Quality, Sandbox และ `validate`; Unit/Regression 119/119 และ Synthetic PDF.js 5/5 สำเร็จ
- ชุดพัฒนาปัจจุบัน: อ่าน CSV ต้นทาง Google Sheets ทั้งใน Admin และ Staff Directory แบบจำกัด 1,000,000 ไบต์ **ระหว่างอ่าน Stream** ไม่ใช่หลังโหลด Response ทั้งหมด; เพิ่มกรณี Chunked, Content-Length ปลอม, UTF-8 และ Boundary Test
- `d84b7da` ผ่าน Quality, Sandbox และ `validate` รวม 119/119 Node Tests และ 5/5 PDF.js Synthetic Tests
- ชุดล่าสุดจำกัด JSON สำหรับ Admin Login ที่ 2,048 ไบต์ระหว่างอ่านและแยกผลผิดรูปแบบ 400 / ขนาดเกิน 413 จาก 503 โดยยังคง Rate Limit และการตรวจรหัสผ่านเดิม
- `ec87ee5` ผ่าน Quality, Sandbox, `validate` ครบ 120/120 Unit/Regression และ 5/5 PDF.js Synthetic Tests
- ชุดล่าสุดจำกัดการอ่าน Admin Stage/Upload Request Body ที่ 1,900,000 **ไบต์** ก่อนแปลง JSON, ส่ง 413 เมื่อเกินขนาด และ 400 เมื่อ JSON ไม่ถูกต้อง พร้อมทดสอบว่าไม่เพิ่มข้อมูล Stage
- **ยังไม่อ้างว่า Commit ใหม่นี้ผ่าน CI** จนกว่าจะยืนยันงานทดสอบที่ SHA ใหม่ครบ

## Release Gates — NO-GO
| Gate | สถานะและเงื่อนไขที่ขาด |
|---|---|
| G1: Exact SHA CI | ec87ee5 ผ่าน; ชุดแก้ไข Upload Body ใหม่ต้องตรวจ CI ตาม SHA |
| G2: Next.js → Supabase Test จริง | **NO-GO**; ต้องทดสอบด้วย Test-only Service-role Key ในพื้นที่ส่วนตัว |
| G3: PDF จริงทุกเดือน | **NO-GO**; ต้องใช้ PDF.js และทะเบียนจริงบนเครื่องผู้มีสิทธิ์ |
| G4: Backup และ Restore DB + Storage จริง | **NO-GO**; ตรวจสำเนา Hash อย่างเดียวยังไม่เพียงพอ |
| G5: Secrets / Domain | **NO-GO**; Vercel Server-only Env ไม่ครบ |
| G6: Production Security Cutover | **NO-GO**; RPC/Indexes/RLS/GRANT/Storage ยังไม่พร้อมและต้องได้รับอนุมัติ |
| G7: Legacy Storage | **NO-GO**; ต้องคงทั้ง 12 objects และตรวจ 3 objects ที่ไม่มีประวัติอ้างอิง |
| G8: อนุมัติ Production | **NO-GO**; ยังไม่มีอนุมัติ Merge/Deploy/Migration รายการเฉพาะ |

## ความเสี่ยงเร่งด่วน / สิ่งที่ต้องตัดสินใจ
ข้อมูลเงินเดือน Production ยังอาจเข้าถึงได้ผ่านสิทธิ์สาธารณะของ Supabase Data API และ Storage; ให้ผู้รับผิดชอบจัดเตรียมแผนลดความเสี่ยง, Backup/Restore และ Cutover อย่างประสานกันโดยเร็ว ห้ามเพียงเปิด RLS หรือปิด Bucket ข้างเดียวแล้วทำให้ระบบเดิมหยุดทำงานโดยไร้แผน

## วิธีทำงานต่อ
ตรวจ GitHub HEAD/CI, Vercel Deploy และ SQL Metadata ใหม่ทุกครั้ง; งานอ่าน/ตรวจที่ไม่ขึ้นกับกันให้ทำพร้อมกัน; งานแก้ Source รวมเป็นหนึ่ง Commit; ยืนยันทั้ง Quality, Browser และ `validate` ที่ SHA เดียวกัน แล้วจึงปรับ Snapshot นี้เมื่อจำเป็น
