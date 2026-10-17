# slip-lpsec — PROJECT_STATUS
สถานะที่ตรวจเมื่อ 17 ตุลาคม 2569; **Snapshot ไม่ใช่การติดตามแบบ Real-time**

## หลักฐานก่อนปรับ Workflow
- Repository: `MrPhacharapon/slip-lpsec`
- Branch ทดสอบ: `fix/payroll-pdf-validation-no-deploy`; ล่าสุดที่ **ยืนยัน CI ผ่าน**: `7a1915325cd28d974697911cccf2ca05372f5148`
- GitHub Actions: [Run #39019244906](https://github.com/MrPhacharapon/slip-lpsec/actions/runs/39019244906) — **SUCCESS สำหรับ SHA เดิม**; Unit 94/94, PDF.js สมมติ 5/5, TypeScript, ESLint, Build และ Browser Mock E2E ผ่าน
- Production Main: `fdced74510f57ab83a758642f2edba08dad0b316`; Vercel Production READY ที่ Commit เดิม ไม่ได้ Deploy จาก Branch นี้
- Supabase Test: `slips=0`, `upload_history=0`, `storage.objects=0`, `rate_limits=0`; bucket slips เป็น Private
- Supabase Production: `slips=338`, `upload_history=9`, `storage.objects=12`; RLS ปิด 2 ตารางและ Storage slips เป็น Public
- Vercel Environment Metadata: มีเพียง 4 keys (2 คีย์ LINE และ 2 คีย์ Supabase แบบ Public); ยังไม่พร้อมสำหรับ Server-only App ใหม่
- ข้อมูลนี้อ่านเฉพาะจำนวนและสถานะ ไม่เรียก PDF จริง รายชื่อ เลขบัญชีหรือ Key

## สิ่งที่กำลังดำเนินการในชุด Commit นี้
- เพิ่มข้อกำหนดที่ยืนยันและขอบเขตสิทธิ์ลง `AGENTS.md` + `PROJECT_RULES.md`
- เพิ่ม `ACCEPTANCE_CRITERIA.md` และชุดทดสอบ Governance/CI
- แยก CI เป็น Quality กับ Build/PDF.js/Browser E2E ที่ทำงานขนานกัน
- เพิ่ม Fail-closed `validate` Gate รวม และยกเลิก Push CI เก่าที่ถูกแทนที่บน Branch ทดสอบ
- ปรับข้อความในเอกสาร Go/No-Go เดิมให้สอดคล้องกับเงื่อนไขตรวจเดือน–ปี PDF

**หมายเหตุความถูกต้อง:** ณ เวลาบันทึกไฟล์นี้ ยังไม่อ้างว่า Commit Governance/CI ใหม่ผ่าน ผล CI ข้างต้นเป็นของ SHA ก่อนแก้ไข ต้องตรวจ Workflow Run ที่ตรงกับ SHA หลัง Commit ใหม่อีกครั้งก่อนรายงานว่าผ่าน

## Release Gates — NO-GO
| Gate | สถานะและเงื่อนไขที่ขาด |
|---|---|
| G1: Exact SHA CI | Baseline ผ่าน; Commit ใหม่ต้องตรวจ CI แยก |
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
