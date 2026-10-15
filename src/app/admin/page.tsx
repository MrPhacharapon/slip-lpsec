"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, UploadCloud, Settings, FileText, CheckCircle2, History, Trash2, GripVertical, Eye } from "lucide-react";
import { PDFDocument } from 'pdf-lib';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
// @ts-ignore
import Papa from 'papaparse';
import { parseRoster, identifyPageSlips, assertUniquePeriod, validateSlipPageLayout } from "@/lib/slip-validation";
import { ensurePdfJsMapCompatibility } from "@/lib/pdfjs-compat";
import type { PdfToken, RosterPerson, PageRegion } from "@/lib/slip-validation";


const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];
const YEARS = ["2569", "2568", "2567"];

type HistoryItem = {
  id: string;
  month: string;
  year: string;
  file_name: string;
  storage_path: string;
  created_at: string;
};

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const router = useRouter();

  const [sheetUrl, setSheetUrl] = useState("https://docs.google.com/spreadsheets/d/1warnAj4x4d7lZecJ3vApaGltSxx1Ji_wv2CkOhcF0nI/edit?gid=0#gid=0");
  const [selectedMonth, setSelectedMonth] = useState("มกราคม");
  const [selectedYear, setSelectedYear] = useState("2569");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [notifyLine, setNotifyLine] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { cache: "no-store" })
      .then(r => r.json())
      .then(v => {
        if (!active) return;
        if (!v.authenticated) { setIsAuthenticated(false); router.push("/"); return; }
        setIsMounted(true); setIsAuthenticated(true);
        void fetchHistory();
      }).catch(() => { if (active) { setIsAuthenticated(false); router.push("/"); } });
    return () => { active = false; };
  }, [router]);

  const fetchHistory = async () => {
    const response = await fetch("/api/admin/history", { cache: "no-store" });
    if (!response.ok) throw new Error("โหลดประวัติไม่สำเร็จ");
    const { history } = await response.json();
    setHistoryItems(history);
  };

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    
    const startIndex = result.source.index;
    const endIndex = result.destination.index;
    
    if (startIndex === endIndex) return;

    // 1. Update UI locally immediately
    const newItems = Array.from(historyItems);
    const [removed] = newItems.splice(startIndex, 1);
    newItems.splice(endIndex, 0, removed);
    setHistoryItems(newItems);

    fetch("/api/admin/history", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: newItems.map(item => item.id) }),
    }).then(r => { if (!r.ok) throw new Error("ไม่สามารถจัดเรียงได้"); })
      .catch(() => { void fetchHistory().catch(() => alert("โหลดประวัติไม่สำเร็จ")); });
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || isUploading) return;
    setIsUploading(true);
    setUploadSuccess(false);
    try {
      const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) throw new Error("ลิงก์ทะเบียน Google Sheet ไม่ถูกต้อง");
      const response = await fetch(
        "https://docs.google.com/spreadsheets/d/" + match[1] + "/export?format=csv&gid=0",
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("อ่านทะเบียนบุคลากรไม่ได้");
      const rawRoster = await response.text();
      const roster = parseRoster(Papa.parse<string[]>(rawRoster, { skipEmptyLines: true }).data);

      if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("รองรับเฉพาะไฟล์ PDF");
      }
      const buffer = await file.arrayBuffer();
      ensurePdfJsMapCompatibility();
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.compat.mjs";
      const doc = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      if (!doc.numPages || doc.numPages > 500) throw new Error("จำนวนหน้า PDF ไม่ถูกต้องหรือมากเกินกำหนด");

      // Read-only preflight: never delete old payroll records to replace a month.
      const preflight = await fetch("/api/admin/preflight", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth, year: selectedYear }),
      });
      if (!preflight.ok) throw new Error("ไม่สามารถตรวจรายการเดิมได้");
      if (!(await preflight.json()).clear)
        throw new Error("เดือนนี้มีข้อมูลอยู่แล้ว: ไม่อนุญาตให้เขียนทับ โปรดใช้กระบวนการทบทวนชุดข้อมูล");

      type Candidate = { pageIndex: number; person: RosterPerson; region: PageRegion };
      const mapped: Candidate[] = [];
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
        const page = await doc.getPage(pageIndex + 1);
        if (page.rotate % 360 !== 0 || page.view[1] !== 0) {
          throw new Error("พบหน้าหมุนหรือมีตำแหน่งเริ่มต้นผิดปกติ: หน้า " + (pageIndex + 1));
        }
        const text = await page.getTextContent();
        const tokens: PdfToken[] = text.items
          .filter((item): item is typeof item & { str: string; transform: number[] } =>
            "str" in item && "transform" in item)
          .map(item => ({ str: item.str, y: item.transform[5] }));
        const pageHeight = page.view[3] - page.view[1];
        const pageWidth = page.view[2] - page.view[0];
        try {
          const layout = validateSlipPageLayout(
            tokens, pageWidth, pageHeight
          );
          const identified = identifyPageSlips(tokens, pageHeight, roster);
          if ((layout === "single" && (
              identified.length !== 1 || identified[0].region !== "full"
            )) ||
            (layout === "double" && (
              identified.length !== 2 ||
              identified[0].region !== "top" ||
              identified[1].region !== "bottom"
            ))) {
            throw new Error("จำนวนสลิปที่จับคู่ได้ไม่ตรงกับโครงสร้างหน้าของ PDF");
          }
          mapped.push(...identified.map(({ person, region }) =>
            ({ pageIndex, person, region })));
        } catch (error) {
          throw new Error("หน้า " + (pageIndex + 1) + ": " +
            (error instanceof Error ? error.message : "อ่านเลขบัญชีไม่สำเร็จ"));
        }
      }
      assertUniquePeriod(mapped);

      // Render selected regions into fresh raster PDFs; never retain hidden
      // text/resources from the other person's half of the source PDF.
      const rows: Array<{
        name: string; bank_account: string; month: string; year: string; pdf_base64: string;
      }> = [];
      for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex++) {
        const page = await doc.getPage(pageIndex + 1);
        const view = page.getViewport({ scale: 2.5 });
        if (view.width * view.height > 12000000) {
          throw new Error("PDF หน้า " + (pageIndex + 1) + " มีขนาดใหญ่เกินกำหนด");
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("ไม่สามารถเตรียมภาพ PDF ได้");
        await page.render({ canvasContext: ctx, canvas, viewport: view }).promise;
        for (const entry of mapped.filter(e => e.pageIndex === pageIndex)) {
          const mid = Math.floor(canvas.height / 2);
          const sourceY = entry.region === "bottom" ? mid : 0;
          const targetHeight = entry.region === "full" ? canvas.height :
            entry.region === "top" ? mid : canvas.height - mid;
          const sliced = document.createElement("canvas");
          sliced.width = canvas.width;
          sliced.height = targetHeight;
          const slicedCtx = sliced.getContext("2d");
          if (!slicedCtx) throw new Error("ไม่สามารถตัดแบ่งภาพ PDF ได้");
          slicedCtx.fillStyle = "#ffffff";
          slicedCtx.fillRect(0, 0, sliced.width, sliced.height);
          slicedCtx.drawImage(canvas, 0, sourceY, canvas.width, targetHeight,
            0, 0, sliced.width, targetHeight);
          const jpeg = await new Promise<Blob>((resolve, reject) =>
            sliced.toBlob(b => b ? resolve(b) : reject(new Error("สร้างไฟล์ภาพไม่สำเร็จ")),
              "image/jpeg", 0.96));
          const safePdf = await PDFDocument.create();
          const jpg = await safePdf.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
          const destination = safePdf.addPage([sliced.width / 2.5, sliced.height / 2.5]);
          destination.drawImage(jpg, { x: 0, y: 0,
            width: destination.getWidth(), height: destination.getHeight() });
          rows.push({ name: entry.person.name, bank_account: entry.person.bankAccount,
            month: selectedMonth, year: selectedYear,
            pdf_base64: await safePdf.saveAsBase64({ dataUri: false }) });
          sliced.width = 0; sliced.height = 0;
        }
        canvas.width = 0; canvas.height = 0;
      }
      if (rows.length !== mapped.length || !rows.length) {
        throw new Error("จำนวนสลิปที่ตรวจและจำนวนไฟล์ที่สร้างไม่ตรงกัน");
      }
      if (!window.confirm("ตรวจสอบผ่าน " + rows.length + " รายการจาก " + doc.numPages +
          " หน้า\nบันทึกเฉพาะเดือนใหม่ (ไม่เขียนทับรายการเดิม) หรือไม่?")) return;

      // Stage small batches through an authenticated server route. Until
      // finalize inserts upload_history, staff searches cannot see the period.
      let pending: typeof rows = [];
      const flush = async () => {
        if (!pending.length) return;
        const response = await fetch("/api/admin/slips", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: pending }), cache: "no-store",
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "บันทึกสลิปบางส่วนไม่สำเร็จ กรุณาติดต่อผู้ดูแล ห้ามอัปโหลดซ้ำ");
        }
        pending = [];
      };
      for (const row of rows) {
        if (pending.length && JSON.stringify({ rows: [...pending, row] }).length > 1_500_000)
          await flush();
        if (JSON.stringify({ rows: [row] }).length > 1_500_000)
          throw new Error("ไฟล์สลิปรายบุคคลใหญ่เกินกำหนด");
        pending.push(row);
        if (pending.length >= 8) await flush();
      }
      await flush();
      const finished = await fetch("/api/admin/finalize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth, year: selectedYear,
          fileName: file.name, expectedCount: rows.length }), cache: "no-store",
      });
      if (!finished.ok)
        throw new Error("บันทึกไฟล์แล้ว แต่ยังไม่เผยแพร่ โปรดตรวจสอบสถานะข้อมูลก่อนดำเนินการต่อ");
      setUploadSuccess(true);
      await fetchHistory();
      setFile(null);
    } catch (error) {
      console.error("Payroll import failed:", error instanceof Error ? error.message : "unknown");
      alert(error instanceof Error ? error.message : "ตรวจสอบเอกสารไม่สำเร็จ");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string, storagePath: string, month: string, year: string) => {
    if (!confirm(`คุณต้องการลบข้อมูลสลิปเดือน ${month} ${year} ใช่หรือไม่? (ข้อมูลสลิปย่อยจะถูกลบทั้งหมด)`)) return;
    const response = await fetch("/api/admin/history", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, month, year }), cache: "no-store",
    });
    if (!response.ok) { alert((await response.json()).error || "ลบข้อมูลไม่สำเร็จ"); return; }
    setHistoryItems(historyItems.filter(item => item.id !== id));
  };

  const handleViewFile = (storagePath: string) => {
    if (!storagePath) { alert("ไม่มีไฟล์บันทึกไว้ในระบบ"); return; }
    window.open("/api/admin/storage?path=" + encodeURIComponent(storagePath), "_blank");
  };

  const handleLogout = async () => {
    await fetch("/api/auth", { method: "DELETE" }).catch(() => {});
    router.push("/");
  };

  if (isAuthenticated === null) {
    return <div className="min-h-screen flex items-center justify-center text-emerald-600">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (isAuthenticated === false) {
    return null;
  }

  return (
    <main className="min-h-screen p-6 md:p-12 relative overflow-hidden">
      <div className="max-w-6xl mx-auto z-10 relative space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glass-panel p-6 bg-white/70">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">ระบบจัดการสลิปเงินเดือน</h1>
            <p className="text-slate-500 text-sm mt-1">อัปโหลดไฟล์ PDF รวม และตั้งค่าฐานข้อมูล</p>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-slate-600 hover:text-rose-600 bg-white/80 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200 shadow-sm"
          >
            ออกจากระบบ
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Settings & Upload */}
          <div className="lg:col-span-5 space-y-8">
            <div className="glass-panel p-6 bg-white/70">
              <div className="flex items-center gap-2 mb-4 text-slate-800">
                <Settings className="w-5 h-5 text-emerald-500" />
                <h2 className="font-semibold">ตั้งค่าฐานข้อมูล</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-2">ลิงก์ Google Sheet (รายชื่อและเลขบัญชี)</label>
                  <input
                    type="url"
                    className="glass-input w-full text-sm bg-white"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/..."
                  />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  ระบบจะอ่านข้อมูลพนักงานเพื่อใช้แยกไฟล์อัตโนมัติจากลิงก์นี้
                </p>
              </div>
            </div>

            <div className="glass-panel p-6 bg-white/70">
              <div className="flex items-center gap-2 mb-6 text-slate-800">
                <UploadCloud className="w-5 h-5 text-emerald-500" />
                <h2 className="font-semibold">อัปโหลดสลิปประจำเดือน</h2>
              </div>
              
              <form onSubmit={handleUpload} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">เดือน</label>
                    <select 
                      className="glass-input w-full bg-white"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                    >
                      {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-2">พ.ศ.</label>
                    <select 
                      className="glass-input w-full bg-white"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                    >
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-2">ไฟล์ PDF (ไฟล์รวมสลิป)</label>
                  <div className="relative">
                    <input
                      type="file"
                      accept="application/pdf"
                      required
                      className="hidden"
                      id="pdf-upload"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                    <label 
                      htmlFor="pdf-upload"
                      className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                        file ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/50 bg-white'
                      }`}
                    >
                      {file ? (
                        <div className="flex flex-col items-center text-emerald-600">
                          <FileText className="w-10 h-10 mb-2" />
                          <span className="font-medium text-center px-4 truncate w-full">{file.name}</span>
                          <span className="text-xs mt-1 text-emerald-500/70">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-slate-400">
                          <UploadCloud className="w-10 h-10 mb-2 text-slate-300" />
                          <span className="font-medium text-slate-600">คลิกเพื่อเลือกไฟล์ PDF</span>
                          <span className="text-xs mt-1">หรือลากไฟล์มาวางที่นี่</span>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-white/50 p-4 rounded-xl border border-slate-200">
                  <input
                    type="checkbox"
                    id="notify-line"
                    checked={notifyLine}
                    onChange={(e) => setNotifyLine(e.target.checked)}
                    className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <label htmlFor="notify-line" className="text-sm text-slate-700 cursor-pointer flex-1 font-medium">
                    ส่งแจ้งเตือนไปยัง LINE กลุ่ม (เมื่ออัปโหลดสำเร็จ)
                  </label>
                </div>

                {uploadSuccess && (
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 mt-4">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <div>
                        <p className="font-medium text-sm">อัปโหลดสำเร็จ!</p>
                        <p className="text-xs opacity-80 mt-0.5">ระบบแยกไฟล์และผูกเลขบัญชีเรียบร้อยแล้ว</p>
                      </div>
                    </div>
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={isUploading || !file}
                  className="btn-primary w-full flex items-center justify-center gap-2 shadow-emerald-500/20"
                >
                  {isUploading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      กำลังประมวลผล...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-5 h-5" />
                      อัพโหลดไฟล์
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: History */}
          <div className="lg:col-span-7 space-y-8">
            <div className="glass-panel p-6 bg-white/70 h-full min-h-[600px]">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 text-slate-800">
                  <History className="w-5 h-5 text-emerald-500" />
                  <h2 className="font-semibold">ประวัติการอัปโหลด</h2>
                </div>
              </div>

              {historyItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-center">
                  <FileText className="w-12 h-12 mb-3 text-slate-200" />
                  <p>ยังไม่มีประวัติการอัปโหลด</p>
                </div>
              ) : isMounted ? (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable 
                    droppableId="history-list"
                    renderClone={(provided, snapshot, rubric) => {
                      const item = historyItems[rubric.source.index];
                      return (
                        <div
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          ref={provided.innerRef}
                          style={provided.draggableProps.style}
                          className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-emerald-400 shadow-xl scale-[1.02] z-[9999]"
                        >
                          <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-emerald-500 shrink-0">
                            <GripVertical className="w-5 h-5" />
                          </div>
                          
                          <div className="flex-1 min-w-0 w-full">
                            <h3 className="font-medium text-slate-800 truncate">
                              สลิปเดือน {item.month} {item.year}
                            </h3>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs text-slate-500 mt-1">
                              <span>อัปโหลดเมื่อ: {new Date(item.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
                              <span className="truncate">{item.file_name}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  >
                    {(provided) => (
                      <div 
                        className="space-y-3" 
                        {...provided.droppableProps} 
                        ref={provided.innerRef}
                      >
                        {historyItems.map((item, index) => (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(provided, snapshot) => (
                              <div 
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                style={provided.draggableProps.style}
                                className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border ${
                                  snapshot.isDragging 
                                    ? 'border-emerald-400 shadow-xl scale-[1.02] z-50 relative' 
                                    : 'border-slate-100 shadow-sm hover:shadow-md'
                                } transition-all group`}
                              >
                                <div 
                                  {...provided.dragHandleProps}
                                  className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 cursor-grab active:cursor-grabbing hover:text-emerald-500 hover:bg-emerald-50 transition-colors shrink-0"
                                >
                                  <GripVertical className="w-5 h-5" />
                                </div>
                                
                                <div className="flex-1 min-w-0 w-full">
                                  <h3 className="font-medium text-slate-800 truncate">
                                    สลิปเดือน {item.month} {item.year}
                                  </h3>
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs text-slate-500 mt-1">
                                    <span>อัปโหลดเมื่อ: {new Date(item.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    <span className="w-1 h-1 rounded-full bg-slate-300 hidden sm:block" />
                                    <span className="truncate">{item.file_name}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end mt-2 sm:mt-0">
                                  <button 
                                    onClick={() => handleViewFile(item.storage_path)}
                                    className="flex-1 sm:flex-none flex items-center justify-center p-2 text-slate-500 hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 rounded-xl transition-colors"
                                    title="ดูไฟล์"
                                  >
                                    <Eye className="w-4 h-4 sm:mr-0" />
                                  </button>
                                  <button 
                                    onClick={() => handleDelete(item.id, item.storage_path, item.month, item.year)}
                                    className="flex-1 sm:flex-none flex items-center justify-center p-2 text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-xl transition-colors"
                                    title="ลบข้อมูล"
                                  >
                                    <Trash2 className="w-4 h-4 sm:mr-0" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              ) : null}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
