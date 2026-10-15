/** Fail-closed checks for payroll PDF mapping. No salary data is logged. */
export type RosterPerson = { name: string; bankAccount: string };
export type PdfToken = { str: string; y: number };
export type PageRegion = "top" | "bottom" | "full";
export type VerifiedSlip = { person: RosterPerson; region: PageRegion };

export class SlipValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlipValidationError";
  }
}

const normalizeText = (text: string): string =>
  text.normalize("NFKC").replace(/[\s\u200B-\u200D\uFEFF]/g, "");

const stripAccountSeparators = (text: string): string =>
  text.replace(/[\s\-\u200B-\u200D\uFEFF]/g, "");

export function parseRoster(rows: string[][]): RosterPerson[] {
  const persons: RosterPerson[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const name = (row[0] ?? "").trim();
    const rawAccount = (row[2] ?? "").trim();
    if (!name && !rawAccount) continue;
    if (/^(ชื่อ|ชื่อ[\s-]*นามสกุล)/.test(name) || /^(เลขที่)?บัญชี/.test(rawAccount)) continue;
    const bankAccount = stripAccountSeparators(rawAccount);
    if (!name || !/^\d{10}$/.test(bankAccount)) {
      throw new SlipValidationError(`ทะเบียนบุคลากรแถว ${index + 1} ชื่อหรือเลขบัญชีไม่ถูกต้อง`);
    }
    if (seen.has(bankAccount)) {
      throw new SlipValidationError(`ทะเบียนบุคลากรมีเลขบัญชีซ้ำ (แถว ${index + 1})`);
    }
    seen.add(bankAccount);
    persons.push({ name, bankAccount });
  }
  if (!persons.length) throw new SlipValidationError("ไม่พบทะเบียนบุคลากรที่ใช้ตรวจสอบได้");
  return persons;
}

function accountMatches(tokens: PdfToken[], roster: RosterPerson[]): RosterPerson[] {
  const joined = tokens.map((token) => token.str).join(" ");
  // PDF generators frequently split digits into separate text items.
  const compact = stripAccountSeparators(tokens.map((token) => token.str).join(""));
  return roster.filter(({ bankAccount }) =>
    new RegExp(`(^|\\D)${bankAccount}(?!\\d)`).test(joined) ||
    new RegExp(`(^|\\D)${bankAccount}(?!\\d)`).test(compact)
  );
}

function matchesName(tokens: PdfToken[], expectedName: string): boolean {
  const compact = normalizeText(tokens.map((token) => token.str).join(""));
  const name = normalizeText(expectedName);
  return compact.includes(name);
}

function containsSlipHeading(tokens: PdfToken[]): boolean {
  const text = normalizeText(tokens.map((token) => token.str).join(""));
  return text.includes("ใบรับรองการจ่ายเงินเดือน") ||
    text.includes("ชื่อ-นามสกุล") || text.includes("ชื่อ–นามสกุล");
}

/**
 * Supports one full-page slip or two slips occupying the top and bottom halves.
 * Rejects unrecognized/ambiguous layouts instead of guessing from sheet order.
 */
export function identifyPageSlips(
  tokens: PdfToken[], pageHeight: number, roster: RosterPerson[]
): VerifiedSlip[] {
  if (!(pageHeight > 0) || !tokens.length) {
    throw new SlipValidationError("ไม่พบข้อความสำหรับระบุเจ้าของสลิป");
  }
  const midpoint = pageHeight / 2;
  const top = tokens.filter(({ y }) => y >= midpoint);
  const bottom = tokens.filter(({ y }) => y < midpoint);
  const topPeople = accountMatches(top, roster);
  const bottomPeople = accountMatches(bottom, roster);
  const topHeading = containsSlipHeading(top);
  const bottomHeading = containsSlipHeading(bottom);

  if (topPeople.length > 1 || bottomPeople.length > 1) {
    throw new SlipValidationError("พบหลายเลขบัญชีในสลิปส่วนเดียวกัน");
  }
  if (topPeople.length === 1 && bottomPeople.length === 1) {
    if (topPeople[0].bankAccount === bottomPeople[0].bankAccount) {
      throw new SlipValidationError("เลขบัญชีซ้ำในสองส่วนของหน้าเดียวกัน");
    }
    const topNames = roster.filter((entry) => matchesName(top, entry.name));
    const bottomNames = roster.filter((entry) => matchesName(bottom, entry.name));
    if (topNames.length !== 1 || bottomNames.length !== 1 ||
        topNames[0].bankAccount !== topPeople[0].bankAccount ||
        bottomNames[0].bankAccount !== bottomPeople[0].bankAccount) {
      throw new SlipValidationError("ชื่อในแต่ละสลิปไม่ตรงหรือพบชื่อบุคลากรหลายคน");
    }
    return [{ person: topPeople[0], region: "top" },
            { person: bottomPeople[0], region: "bottom" }];
  }
  if (topHeading && bottomHeading) {
    throw new SlipValidationError("พบสลิปสองคนในหน้าเดียว แต่ระบุเจ้าของได้ไม่ครบ");
  }
  const allPeople = accountMatches(tokens, roster);
  if (allPeople.length !== 1) {
    throw new SlipValidationError("ไม่สามารถระบุเลขบัญชีเจ้าของสลิปได้อย่างแน่นอน");
  }
  const namesOnPage = roster.filter((entry) => matchesName(tokens, entry.name));
  if (namesOnPage.length !== 1 ||
      namesOnPage[0].bankAccount !== allPeople[0].bankAccount) {
    throw new SlipValidationError("พบชื่อบุคลากรอื่นหรือชื่อไม่ตรงเลขบัญชี ห้ามส่ง PDF ทั้งหน้า");
  }
  // A missing second account with a second name/header is ambiguous: never give away a full page.
  if ((topHeading && bottom.length > 5 && bottomPeople.length === 0 &&
      containsSlipHeading(bottom)) ||
      (bottomHeading && top.length > 5 && topPeople.length === 0 &&
      containsSlipHeading(top))) {
    throw new SlipValidationError("ไม่สามารถแยกสลิปทั้งหน้าได้อย่างปลอดภัย");
  }
  return [{ person: allPeople[0], region: "full" }];
}

export function assertUniquePeriod(slips: VerifiedSlip[]): void {
  if (slips.length === 0) throw new SlipValidationError("ไม่มีสลิปที่ผ่านการตรวจสอบ");
  const seen = new Set<string>();
  for (const slip of slips) {
    if (seen.has(slip.person.bankAccount)) {
      throw new SlipValidationError("พบเลขบัญชีซ้ำในไฟล์ PDF ต้นฉบับ");
    }
    seen.add(slip.person.bankAccount);
  }
}


/**
 * Validates the two source layouts confirmed across Jan-Oct 2569:
 * 1071x792 PDF points, either one slip (upper half with lower half blank)
 * or two slips divided at y=396. The document's printed period, not the
 * UI selection alone, must match. This only handles native PDF text, not OCR.
 *
 * Input token y coordinates use the PDF.js bottom-origin transform[5].
 */
export function validateSlipPageLayout(
  tokens: PdfToken[],
  pageWidth: number,
  pageHeight: number,
  expectedMonth: string,
  expectedYear: string
): "single" | "double" {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) ||
      Math.abs(pageWidth - 1071) > 3 || Math.abs(pageHeight - 792) > 3) {
    throw new SlipValidationError("ขนาด PDF ไม่ตรงกับแบบฟอร์มที่รองรับ");
  }
  const top = tokens.filter(({ y }) => y >= pageHeight / 2);
  const bottom = tokens.filter(({ y }) => y < pageHeight / 2);
  const topText = normalizeText(top.map(t => t.str).join(""));
  const bottomText = normalizeText(bottom.map(t => t.str).join(""));
  const printedPeriod = normalizeText("ประจำเดือน" + expectedMonth + "ปีพ.ศ." + expectedYear);
  const heading = "ใบรับรองการจ่ายเงินเดือน";
  const labels = ["ชื่อ-นามสกุล", "เลขที่บัญชี"];
  const validPart = (text: string) =>
    text.includes(heading) && text.includes(printedPeriod) &&
    labels.every(label => text.includes(label));

  if (!validPart(topText)) {
    throw new SlipValidationError("หัวเอกสาร ชื่อบัญชี หรือเดือนปีที่พิมพ์บน PDF ไม่ตรงกับที่เลือก");
  }
  if (bottomText.includes(heading) || bottomText.includes("ชื่อ-นามสกุล") ||
      bottomText.includes("เลขที่บัญชี")) {
    if (!validPart(bottomText)) {
      throw new SlipValidationError("พบสลิปครึ่งล่างที่ข้อมูลหัวเอกสารไม่ครบหรือเดือนปีไม่ตรง");
    }
    return "double";
  }
  return "single";
}
