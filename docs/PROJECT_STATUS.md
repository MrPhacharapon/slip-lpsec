# slip-lpsec — PROJECT_STATUS
สถานะที่ตรวจเมื่อ 18 ตุลาคม 2569; **Snapshot ไม่ใช่การติดตามแบบ Real-time**

## หลักฐานก่อนชุดแก้ไขล่าสุด
- Repository: `MrPhacharapon/slip-lpsec`
- Branch ทดสอบ: `fix/payroll-pdf-validation-no-deploy`; ล่าสุดที่ **ยืนยัน CI ผ่าน**: `87ccce2649bc93145e30b21f4de69f566dcb728a`
- GitHub Actions: [Run #39138596689](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39138596689) — **SUCCESS สำหรับ SHA เดิม**; Unit 105/105, PDF.js สมมติ 5/5, TypeScript, ESLint, Build และ Browser Mock E2E ผ่าน
- Production Main: `fdced74510f57ab83a758642f2edba08dad0b316`; Vercel Production READY ที่ Commit เดิม ไม่ได้ Deploy จาก Branch นี้
- Supabase Test: `slips=0`, `upload_history=0`, `storage.objects=0`, `rate_limits=0`; bucket slips เป็น Private
- Supabase Production: `slips=338`, `upload_history=9`, `storage.objects=12`; RLS ปิด 2 ตารางและ Storage slips เป็น Public
- Vercel Environment Metadata: มีเพียง 4 keys (2 คีย์ LINE และ 2 คีย์ Supabase แบบ Public); ยังไม่พร้อมสำหรับ Server-only App ใหม่
- ข้อมูลนี้อ่านเฉพาะจำนวนและสถานะ ไม่เรียก PDF จริง รายชื่อ เลขบัญชีหรือ Key

## สิ่งที่ทำแล้วและงานที่กำลังตรวจ
- Commit `87ccce2` ผ่าน Quality, Browser E2E และ Aggregate `validate` จริง; เพิ่มขนาดคำขอสูงสุด 1,024 ไบต์ใน Public Search/PDF API
- ชุดปรับปรุงปัจจุบัน: ประมวลผล LINE Webhook แบบหลาย Events ตามเอกสาร LINE แทนอ่านเฉพาะ Events[0], ตรวจลายเซ็นก่อนแยกเหตุการณ์, ตรวจ replyToken ซ้ำภายใน Batch และส่ง Reply อย่างมีขีดจำกัด Concurrency; เพิ่ม Raw Body Streaming Cap 1,000,000 ไบต์ก่อน HMAC เพื่อป้องกันคำขอขนาดใหญ่
- CI ของ SHA `00cda6c` พบ Browser E2E ผิดผลคาด: ตัวทดสอบส่ง JSON ที่ตั้งใจให้ผิดรูปแบบจน HMAC ที่ได้รับไม่ตรง; ชุดแก้ไขปัจจุบันส่งไบต์ตรงกับข้อมูลที่ลงลายเซ็นและเพิ่ม Unit Test เฉพาะกรณีนี้ ห้ามนับ SHA ที่ล้มเหลวว่า PASS
- **ยังไม่อ้างว่าชุด Commit ล่าสุดผ่าน CI** จนกว่าจะมีผลของ SHA ใหม่ตรงกันทั้งสอง Jobs และ Aggregate Gate

## Release Gates — NO-GO
| Gate | สถานะและเงื่อนไขที่ขาด |
|---|---|
| G1: Exact SHA CI | 87ccce2 ผ่าน; ชุดปรับปรุงล่าสุดต้องตรวจผล CI ตาม SHA ใหม่ |
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
