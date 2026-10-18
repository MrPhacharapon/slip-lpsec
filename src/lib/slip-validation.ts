/** Fail-closed checks for payroll PDF mapping. No salary data is logged. */
export type RosterPerson = { name: string; bankAccount: string; positionNumber: string };
export type PdfToken = { str: string; y: number };
export type PageRegion = "top" | "bottom" | "full";
export type VerifiedSlip = { person: RosterPerson; region: PageRegion };

export class SlipValidationError extends Error {
  readonly page?: number;
  constructor(message: string, page?: number) {
    super(message);
    this.name = "SlipValidationError";
    this.page = page;
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
    const positionNumber = (row[3] ?? "").trim();
    if (!name && !rawAccount) continue;
    if (/^(ชื่อ|ชื่อ[\s-]*นามสกุล)/.test(name) || /^(เลขที่)?บัญชี/.test(rawAccount)) continue;
    const bankAccount = stripAccountSeparators(rawAccount);
    if (!name || !/^\d{10}$/.test(bankAccount) || !/^\d{7}$/.test(positionNumber)) {
      throw new SlipValidationError(`ทะเบียนบุคลากรแถว ${index + 1} ชื่อ เลขบัญชี หรือเลขตำแหน่งไม่ถูกต้อง`);
    }
    if (seen.has(bankAccount)) {
      throw new SlipValidationError(`ทะเบียนบุคลากรมีเลขบัญชีซ้ำ (แถว ${index + 1})`);
    }
    seen.add(bankAccount);
    persons.push({ name, bankAccount, positionNumber });
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

function matchesPositionNumber(tokens: PdfToken[], expectedPosition: string): boolean {
  const compact = normalizeText(tokens.map(token => token.str).join(""));
  // Verify the position number specifically following the PDF's label.
  const label = normalizeText("เลขตำแหน่ง");
  const occurrences = [...compact.matchAll(new RegExp(label + "([0-9]{7})(?![0-9])", "g"))];
  return occurrences.length === 1 && occurrences[0][1] === expectedPosition;
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
        bottomNames[0].bankAccount !== bottomPeople[0].bankAccount ||
        !matchesPositionNumber(top, topPeople[0].positionNumber) ||
        !matchesPositionNumber(bottom, bottomPeople[0].positionNumber)) {
      throw new SlipValidationError("ชื่อ เลขบัญชี หรือเลขตำแหน่งในแต่ละสลิปไม่ตรงทะเบียน");
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
      namesOnPage[0].bankAccount !== allPeople[0].bankAccount ||
      !matchesPositionNumber(tokens, allPeople[0].positionNumber)) {
    throw new SlipValidationError("ชื่อ เลขบัญชี หรือเลขตำแหน่งไม่ตรงทะเบียน ห้ามส่ง PDF ทั้งหน้า");
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
  // The publication RPC accepts at most 500 slips per period. Reject an
  // oversized source BEFORE rasterization or the first staged database write;
  // otherwise upload could stage rows that can never be published.
  if (slips.length > 500) {
    throw new SlipValidationError("พบสลิปเกิน 500 รายการ ไม่อนุญาตให้อัปโหลดบางส่วนค้างไว้");
  }
  const seen = new Set<string>();
  for (const slip of slips) {
    if (seen.has(slip.person.bankAccount)) {
      throw new SlipValidationError("พบเลขบัญชีซ้ำในไฟล์ PDF ต้นฉบับ");
    }
    seen.add(slip.person.bankAccount);
  }
}


/**
 * The legacy template has one slip per page; the compact template allows
 * one (odd-count last page) or two. Periods are checked separately.
 */
export function validateSlipPageLayout(
  tokens: PdfToken[], pageWidth: number, pageHeight: number
): "single" | "double" {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) ||
      Math.abs(pageWidth - 1071) > 3 || Math.abs(pageHeight - 792) > 3) {
    throw new SlipValidationError("ขนาด PDF ไม่ตรงกับแบบฟอร์มที่รองรับ");
  }
  const top = tokens.filter(({ y }) => y >= pageHeight / 2);
  const bottom = tokens.filter(({ y }) => y < pageHeight / 2);
  const topText = normalizeText(top.map(t => t.str).join(""));
  const bottomText = normalizeText(bottom.map(t => t.str).join(""));
  const heading = "ใบรับรองการจ่ายเงินเดือน";
  const labels = ["ชื่อ-นามสกุล", "เลขที่บัญชี", "เลขตำแหน่ง"].map(normalizeText);
  const headingCount = (text: string) => text.split(heading).length - 1;
  const validPart = (text: string) =>
    headingCount(text) === 1 && labels.every(label => text.includes(label));
  if (!validPart(topText)) {
    throw new SlipValidationError("หัวเอกสารส่วนบนไม่ครบหรือจำนวนหัวเอกสารไม่ถูกต้อง");
  }
  const bottomLooksLikeSlip = headingCount(bottomText) > 0 ||
    labels.some(label => bottomText.includes(label));
  if (bottomLooksLikeSlip) {
    if (!validPart(bottomText)) {
      throw new SlipValidationError("พบข้อมูลสลิปครึ่งล่างแต่หัวเอกสารไม่ครบ");
    }
    return "double";
  }
  return "single";
}

/**
 * Require printed month and year in each slip heading, not only the admin
 * selection. PDF.js may split พ.ศ. across separate text spans or NUL glyphs.
 * Fail closed on missing, inconsistent or multiple period labels.
 */
export function assertSlipPagePeriod(
  tokens: PdfToken[], pageHeight: number, layout: "single" | "double",
  month: string, year: string,
): void {
  const months = [
    "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
  ];
  if (!months.includes(month) || !/^25\d{2}$/.test(year) ||
      !Number.isFinite(pageHeight) || pageHeight <= 0 ||
      (layout !== "single" && layout !== "double")) {
    throw new SlipValidationError("เดือน ปี หรือรูปแบบสลิปไม่ถูกต้อง");
  }
  const regions = layout === "double" ?
    [tokens.filter(t=>t.y>=pageHeight/2),tokens.filter(t=>t.y<pageHeight/2)]
    : [tokens];
  const pattern = new RegExp(
    normalizeText("ประจำเดือน")+"("+months.join("|")+")(?:ปี)?(?:พ\\.?ศ\\.?)?(25[0-9]{2})(?![0-9])",
    "g",
  );
  for (const region of regions) {
    const extracted = normalizeText(region.map(t=>t.str).join(""))
      .replace(/\u0000/g,"")
      .replace(/[๐-๙]/g,d=>String(d.charCodeAt(0)-0x0e50));
    const printed = [...extracted.matchAll(pattern)];
    if (printed.length !== 1 || printed[0][1] !== month || printed[0][2] !== year)
      throw new SlipValidationError("เดือนหรือปีในสลิปไม่ตรงกับที่ผู้ดูแลเลือก");
  }
}

/**
 * Private-only diagnostics for a failed printed-period assertion.
 * These Boolean indicators are NOT proof of a correct payroll period.
 * Never print extracted PDF text, dates of birth, owners or file paths.
 */
export function diagnosePrintedPeriodSignals(
  tokens: PdfToken[], pageHeight: number, layout: "single" | "double",
  expectedMonth: string, expectedYear: string
): Array<{ periodLabel: boolean; selectedMonth: boolean; selectedYear: boolean; recognizedPattern: boolean }> {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0 ||
      (layout !== "single" && layout !== "double")) return [];
  const regions = layout === "double"
    ? [tokens.filter(t => t.y >= pageHeight / 2), tokens.filter(t => t.y < pageHeight / 2)]
    : [tokens];
  const months = [
    "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
  ];
  const label = normalizeText("ประจำเดือน");
  const pattern = new RegExp(
    label + "(" + months.join("|") + ")(?:ปี)?(?:พ\\.?ศ\\.?)?(25[0-9]{2})(?![0-9])",
  );
  return regions.map(region => {
    const normalized = normalizeText(region.map(t => t.str).join(""))
      .replace(/\u0000/g, "")
      .replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0e50));
    return {
      periodLabel: normalized.includes(label),
      selectedMonth: months.includes(expectedMonth) && normalized.includes(normalizeText(expectedMonth)),
      selectedYear: /^25[0-9]{2}$/.test(expectedYear) && normalized.includes(expectedYear),
      recognizedPattern: pattern.test(normalized),
    };
  });
}

/** Enforce the same format throughout the uploaded payroll PDF. */
export function assertSlipDocumentLayout(layouts: Array<"single" | "double">): void {
  if (layouts.length === 0 || layouts.length > 500 ||
      layouts.some(layout => layout !== "single" && layout !== "double")) {
    throw new SlipValidationError("รูปแบบจำนวนหน้าเอกสารไม่ถูกต้อง");
  }
  if (layouts.includes("double")) {
    for (let index = 0; index < layouts.length - 1; index++) {
      if (layouts[index] === "single") {
        throw new SlipValidationError(
          "รูปแบบ B อนุญาตสลิปหนึ่งคนเฉพาะหน้าสุดท้าย: หน้า " + (index + 1),
          index + 1
        );
      }
    }
  }
}
