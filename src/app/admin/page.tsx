"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Lock, UploadCloud, Settings, FileText, CheckCircle2, History, Trash2, GripVertical, Eye } from "lucide-react";
import { PDFDocument } from 'pdf-lib';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
// @ts-ignore
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

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
    const auth = sessionStorage.getItem("adminAuth");
    if (auth !== "true") {
      router.push("/");
    } else {
      setIsMounted(true);
      setIsAuthenticated(true);
      fetchHistory();
    }
  }, [router]);

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('upload_history')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data && !error) {
      setHistoryItems(data);
    }
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

    // 2. Update Supabase to permanently save the new order
    // By resetting created_at, we maintain the "ORDER BY created_at DESC" sorting
    const now = Date.now();
    Promise.all(newItems.map((item, i) => {
      const newTime = new Date(now - i * 1000).toISOString();
      return supabase.from('upload_history').update({ created_at: newTime }).match({ id: item.id });
    })).catch(err => console.error("Reorder DB error:", err));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setUploadSuccess(false);

    try {
      // 1. Fetch Google Sheet CSV
      const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!match) {
        alert("ลิงก์ Google Sheet ไม่ถูกต้อง");
        setIsUploading(false);
        return;
      }
      const sheetId = match[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
      
      const res = await fetch(csvUrl);
      if (!res.ok) {
        alert("ไม่สามารถอ่านข้อมูล Google Sheet ได้ โปรดตรวจสอบการแชร์ไฟล์");
        setIsUploading(false);
        return;
      }
      const csvText = await res.text();
      const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
      const accounts = parsed.data;
      
      // 2. Read PDF for splitting (pdf-lib)
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer.slice(0));
      const pages = pdfDoc.getPages();
      
      if (pages.length === 0) {
        alert("ไม่พบหน้าในไฟล์ PDF");
        setIsUploading(false);
        return;
      }

      // 3. Read PDF for text extraction (pdfjs-dist)
      let pdfjsDoc: any = null;
      let pdfjsLib: any = null;
      try {
        pdfjsLib = await import('pdfjs-dist');
        if (pdfjsLib?.GlobalWorkerOptions) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        }
        pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      } catch (err) {
        console.warn("Could not parse PDF for text extraction. Falling back to sequential mode.", err);
      }
      
      // Clean previous slips for this month and year to prevent duplicates
      await supabase
        .from('slips')
        .delete()
        .match({ month: selectedMonth, year: selectedYear });

      // 4. Match PDF pages/sections to accounts and save to Supabase
      let startIndex = 0;
      if (accounts.length > 0) {
        const headerRowStr = accounts[0].join(' ');
        if (headerRowStr.includes('บัญชี') || headerRowStr.includes('ชื่อ')) {
          startIndex = 1;
        }
      }

      let fallbackIndex = 0;

      for (let i = 0; i < pages.length; i++) {
        const originalPage = pages[i];
        const { width, height } = originalPage.getSize();
        const halfHeight = height / 2;

        let pageSections: Array<{
          account: string | null;
          name: string | null;
          crop: [number, number, number, number] | null;
        }> = [];

        if (pdfjsDoc) {
          try {
            const page = await pdfjsDoc.getPage(i + 1);
            const textContent = await page.getTextContent();
            
            // Check if page contains 2 slips (top half vs bottom half)
            const topItems: string[] = [];
            const bottomItems: string[] = [];

            for (const item of textContent.items as any[]) {
              const y = item.transform ? item.transform[5] : 0;
              if (y >= halfHeight) {
                topItems.push(item.str);
              } else {
                bottomItems.push(item.str);
              }
            }

            const topText = topItems.join(' ');
            const bottomText = bottomItems.join(' ');

            const topAccMatch = topText.match(/\b\d{10}\b/);
            const bottomAccMatch = bottomText.match(/\b\d{10}\b/);

            const hasTwoSlips = !!(topAccMatch && bottomAccMatch);

            if (hasTwoSlips) {
              pageSections = [
                {
                  account: topAccMatch[0],
                  name: null,
                  crop: [0, halfHeight, width, halfHeight]
                },
                {
                  account: bottomAccMatch[0],
                  name: null,
                  crop: [0, 0, width, halfHeight]
                }
              ];
            } else if (topAccMatch) {
              pageSections = [
                {
                  account: topAccMatch[0],
                  name: null,
                  crop: [0, halfHeight, width, halfHeight]
                }
              ];
            } else if (bottomAccMatch) {
              pageSections = [
                {
                  account: bottomAccMatch[0],
                  name: null,
                  crop: [0, 0, width, halfHeight]
                }
              ];
            } else {
              const fullText = (textContent.items as any[]).map((it: any) => it.str).join(' ');
              const fullMatch = fullText.match(/\b\d{10}\b/);
              if (fullMatch) {
                pageSections = [
                  {
                    account: fullMatch[0],
                    name: null,
                    crop: null
                  }
                ];
              }
            }
          } catch (err) {
            console.warn(`Error extracting text on page ${i + 1}`, err);
          }
        }

        // Fallback: If no sections detected via OCR, fallback to 1 whole page
        if (pageSections.length === 0) {
          pageSections = [{ account: null, name: null, crop: null }];
        }

        for (const sec of pageSections) {
          let matchedRow = null;

          if (sec.account) {
            matchedRow = accounts.find((r: string[]) => r[2] && String(r[2]).trim() === sec.account);
          }

          if (!matchedRow) {
            matchedRow = accounts[startIndex + fallbackIndex];
            fallbackIndex++;
          }

          if (!matchedRow && !sec.account) continue;

          const name = matchedRow ? matchedRow[0] : (sec.name || "เจ้าหน้าที่");
          const bankAccount = sec.account || (matchedRow ? String(matchedRow[2]).trim() : "");
          if (!bankAccount) continue;

          const newPdf = await PDFDocument.create();
          const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
          if (sec.crop) {
            copiedPage.setCropBox(sec.crop[0], sec.crop[1], sec.crop[2], sec.crop[3]);
            copiedPage.setMediaBox(sec.crop[0], sec.crop[1], sec.crop[2], sec.crop[3]);
          }
          newPdf.addPage(copiedPage);
          const newPdfBase64 = await newPdf.saveAsBase64({ dataUri: false });

          // Save slip to Supabase
          await supabase.from('slips').insert({
            name: name,
            bank_account: bankAccount,
            month: selectedMonth,
            year: selectedYear,
            pdf_base64: newPdfBase64
          });

          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      // 4. Upload the combined 8MB PDF to Supabase Storage (Using safe filename without Thai characters)
      const safeFileName = `slip_backup_${Date.now()}.pdf`;
      const { error: storageError } = await supabase.storage
        .from('slips')
        .upload(safeFileName, file);

      if (storageError) {
        console.error("Storage error:", storageError);
        alert("คำเตือน: อัปโหลดสลิปสำเร็จ แต่ไม่สามารถสำรองไฟล์ต้นฉบับก้อนใหญ่ลง Storage ได้ (อาจตั้งค่า Policy ไม่ถูกต้อง)");
      }

      // 5. Save History
      const { error: historyError } = await supabase.from('upload_history').insert({
        month: selectedMonth,
        year: selectedYear,
        file_name: file.name,
        storage_path: safeFileName
      });

      if (historyError) {
        console.error("History error:", historyError);
      }

      if (notifyLine) {
        try {
          await fetch('/api/send-line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month: selectedMonth, year: selectedYear })
          });
        } catch (e) {
          console.error("Failed to trigger LINE notification", e);
        }
      }

      setUploadSuccess(true);
      fetchHistory();
      setFile(null);
      
      setTimeout(() => setUploadSuccess(false), 5000);
    } catch (error) {
      console.error("Upload error:", error);
      alert("เกิดข้อผิดพลาดในการอัปโหลด");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string, storagePath: string, month: string, year: string) => {
    if(confirm(`คุณต้องการลบข้อมูลสลิปเดือน ${month} ${year} ใช่หรือไม่? (ข้อมูลสลิปย่อยจะถูกลบทั้งหมด)`)) {
      // 1. Delete original file from Storage
      if (storagePath) {
        await supabase.storage.from('slips').remove([storagePath]);
      }
      
      // 2. Delete all slips for this month/year
      await supabase
        .from('slips')
        .delete()
        .match({ month: month, year: year });

      // 3. Delete history item
      await supabase
        .from('upload_history')
        .delete()
        .match({ id: id });

      // Update UI
      setHistoryItems(historyItems.filter(item => item.id !== id));
    }
  };

  const handleViewFile = (storagePath: string) => {
    if (!storagePath) {
      alert("ไม่มีไฟล์บันทึกไว้ในระบบ");
      return;
    }
    const { data } = supabase.storage.from('slips').getPublicUrl(storagePath);
    window.open(data.publicUrl, '_blank');
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adminAuth");
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
