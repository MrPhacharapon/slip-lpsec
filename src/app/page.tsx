"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Download, FileText, AlertCircle, Settings, X, Lock, Eye, EyeOff, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
// @ts-ignore
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";

const ALL_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

export default function Home() {
  const router = useRouter();
  
  const [bankAccount, setBankAccount] = useState("");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [showBankAccount, setShowBankAccount] = useState(false);
  
  const [fromMonth, setFromMonth] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [toYear, setToYear] = useState("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);
  const [employeeData, setEmployeeData] = useState<{name: string, position: string} | null>(null);

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);

  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    url: string;
    month: string;
    year: string;
    pdfBase64: string;
  } | null>(null);

  const fetchAvailablePeriods = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('upload_history').select('month, year');
      
      if (error) {
        console.error("Supabase fetch error:", error);
        alert(`เกิดข้อผิดพลาดในการโหลดเดือน: ${error.message}`);
        return;
      }

      if (data && data.length > 0) {
        // Get unique months and years
        const uniqueMonths = Array.from(new Set(data.map(d => d.month)));
        const uniqueYears = Array.from(new Set(data.map(d => d.year))).sort((a, b) => Number(b) - Number(a));
        
        // Sort months according to ALL_MONTHS order
        uniqueMonths.sort((a, b) => ALL_MONTHS.indexOf(a) - ALL_MONTHS.indexOf(b));

        setAvailableMonths(uniqueMonths);
        setAvailableYears(uniqueYears);
        
        if (uniqueMonths.length > 0) {
          setFromMonth(uniqueMonths[0]);
          setToMonth(uniqueMonths[uniqueMonths.length - 1]);
        }
        if (uniqueYears.length > 0) {
          setFromYear(uniqueYears[0]);
          setToYear(uniqueYears[0]);
        }
      } else {
        // Data is empty
        console.log("No upload history found.");
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    fetchAvailablePeriods();
  }, [fetchAvailablePeriods]);

  const handleView = (pdfBase64: string, month: string, year: string) => {
    try {
      const byteCharacters = atob(pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      setPreviewModal({
        isOpen: true,
        url: url,
        month: month,
        year: year,
        pdfBase64: pdfBase64,
      });
    } catch {
      alert("ไม่สามารถเปิดดูไฟล์ได้");
    }
  };

  const closePreviewModal = () => {
    if (previewModal?.url) {
      URL.revokeObjectURL(previewModal.url);
    }
    setPreviewModal(null);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankAccount.trim()) return;

    setIsLoading(true);
    setResults(null);
    try {
      const { data, error } = await supabase
        .from('slips')
        .select('month, year, pdf_base64')
        .eq('bank_account', bankAccount.trim());

      if (error) throw error;
      
      // Filter by the selected range
      // For simplicity, we just return what matches exactly or within range
      // Since Thai months are tricky to compare directly, we'll map them to index
      const fromM = ALL_MONTHS.indexOf(fromMonth);
      const toM = ALL_MONTHS.indexOf(toMonth);
      const fromY = Number(fromYear);
      const toY = Number(toYear);

      const filteredData = (data || []).filter(item => {
        const itemM = ALL_MONTHS.indexOf(item.month);
        const itemY = Number(item.year);
        
        // Simple logic: if years match the range exactly
        // To do a real date range, we'd convert to Date objects: (year * 12 + monthIndex)
        const itemScore = itemY * 12 + itemM;
        const fromScore = fromY * 12 + fromM;
        const toScore = toY * 12 + toM;

        // If fromScore > toScore (e.g. they selected backwards), swap them for check
        const min = Math.min(fromScore, toScore);
        const max = Math.max(fromScore, toScore);

        return itemScore >= min && itemScore <= max;
      });
      
      // Sort the results:
      // 1. Year descending (newest first)
      // 2. Month ascending (Jan -> Dec)
      filteredData.sort((a, b) => {
        const yearA = Number(a.year);
        const yearB = Number(b.year);
        if (yearA !== yearB) {
          return yearB - yearA; // Descending Year
        }
        // Same year, sort by month index ascending
        const monthA = ALL_MONTHS.indexOf(a.month);
        const monthB = ALL_MONTHS.indexOf(b.month);
        return monthA - monthB; // Ascending Month (Jan -> Dec)
      });
      
      setResults(filteredData);
      setEmployeeData(null);

      // Fetch employee info from Google Sheets
      try {
        const sheetUrl = "https://docs.google.com/spreadsheets/d/1warnAj4x4d7lZecJ3vApaGltSxx1Ji_wv2CkOhcF0nI/export?format=csv&gid=0";
        const res = await fetch(sheetUrl);
        const csvText = await res.text();
        
        Papa.parse(csvText, {
          complete: (parsed: any) => {
            const rows = parsed.data;
            // Find row where Col 2 (index 2) == bankAccount
            const matchedRow = rows.find((row: any) => row[2] && row[2].toString().trim() === bankAccount.trim());
            if (matchedRow) {
              setEmployeeData({
                name: matchedRow[0],
                position: matchedRow[1]
              });
            }
          }
        });
      } catch (err) {
        console.error("Failed to fetch sheet", err);
      }

    } catch (error) {
      console.error("Search error:", error);
      alert("เกิดข้อผิดพลาดในการค้นหา");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = (pdfBase64: string, month: string, year: string) => {
    try {
      const byteCharacters = atob(pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {type: 'application/pdf'});
      
      const url = URL.createObjectURL(blob);
      
      // วิธีที่ 2: พยายามบังคับดาวน์โหลดผ่าน Tag <a>
      const link = document.createElement('a');
      link.href = url;
      link.download = `slip_${month}_${year}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // ตรวจสอบว่าผู้ใช้เปิดผ่าน LINE In-App Browser หรือไม่
      const isLineApp = /Line/i.test(navigator.userAgent);
      
      if (isLineApp) {
        // วิธีที่ 1 (Fallback): แจ้งเตือนผู้ใช้หากวิธีที่ 2 อาจจะล้มเหลว
        setTimeout(() => {
          alert("คำแนะนำสำหรับแอป LINE:\n\nระบบกำลังพยายามดาวน์โหลดไฟล์... แต่หากคุณครูไม่พบไฟล์สลิปที่ดาวน์โหลด (เนื่องจาก LINE มักจะบล็อกไฟล์)\n\nกรุณากดไอคอน 'จุด 3 จุด' หรือสัญลักษณ์แชร์ที่มุมจอ แล้วเลือกเมนู 'เปิดด้วยเบราว์เซอร์อื่น' (Open in browser/Safari/Chrome) ครับ");
        }, 800); // หน่วงเวลาเล็กน้อยให้หน้าต่างดาวน์โหลดจริงทำงานก่อน (ถ้ามันทำงานได้)
      }
      
    } catch (error) {
      alert("ไม่สามารถดาวน์โหลดไฟล์ได้");
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCheckingAuth(true);
    setAdminError("");
    
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        sessionStorage.setItem("adminAuth", "true");
        router.push("/admin");
      } else {
        setAdminError(data.error || "รหัสผ่านไม่ถูกต้อง");
      }
    } catch (error) {
      setAdminError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setIsCheckingAuth(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-400/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-teal-300/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Admin Entry Button */}
      <div className="w-full max-w-xl z-20 flex justify-end mb-4 relative mt-2 md:mt-6">
        <button 
          onClick={() => setShowAdminModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-emerald-700 bg-white/60 hover:bg-white rounded-xl transition-all border border-slate-200/50 backdrop-blur-sm shadow-sm relative z-30 cursor-pointer"
        >
          <Settings className="w-4 h-4" />
          สำหรับผู้ดูแลระบบ
        </button>
      </div>

      <div className="w-full max-w-xl z-10 flex flex-col items-center flex-1">
        <div className="text-center mb-10 flex flex-col items-center w-full mt-2">
          <img 
            src="https://i.postimg.cc/8kKrvnfY/removebg-preview.png" 
            alt="โลโก้ศูนย์การศึกษาพิเศษ ประจำจังหวัดลำปาง" 
            className="w-24 h-24 object-contain mb-6 drop-shadow-md"
          />
          <h1 className="text-3xl md:text-4xl font-bold mb-3 text-slate-800 leading-tight">
            ระบบค้นหาใบรับรองการจ่ายเงินเดือน
          </h1>
          <h2 className="text-xl md:text-2xl font-semibold mb-4 text-emerald-700">
            ศูนย์การศึกษาพิเศษ ประจำจังหวัดลำปาง
          </h2>
          <p className="text-slate-600 text-lg mt-2">
            กรุณากรอกเลขบัญชีธนาคารที่รับเงินเดือนและเลือกช่วงเวลาเพื่อดาวน์โหลด
          </p>
        </div>

        <div className="glass-panel p-8 mb-8">
          <form onSubmit={handleSearch} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">เลขบัญชีธนาคารที่รับเงินเดือน</label>
              <div className="relative">
                <input
                  type={showBankAccount ? "text" : "password"}
                  required
                  autoComplete="off"
                  placeholder="กรอกเลขบัญชี (ไม่ต้องมีขีด)"
                  className="glass-input w-full bg-white/70 pr-24 font-mono"
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowBankAccount(!showBankAccount)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-emerald-600 transition-colors"
                >
                  {showBankAccount ? (
                    <>
                      <EyeOff className="w-4 h-4" /> ซ่อน
                    </>
                  ) : (
                    <>
                      <Eye className="w-4 h-4" /> แสดง
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">ตั้งแต่เดือน</label>
                <div className="flex gap-2">
                  <select className="glass-input flex-1 bg-white/70" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)}>
                    {availableMonths.length > 0 ? (
                      availableMonths.map(m => <option key={m} value={m}>{m}</option>)
                    ) : (
                      <option value="">(ไม่มีข้อมูล)</option>
                    )}
                  </select>
                  <select className="glass-input w-1/3 bg-white/70" value={fromYear} onChange={(e) => setFromYear(e.target.value)}>
                    {availableYears.length > 0 ? (
                      availableYears.map(y => <option key={y} value={y}>{y}</option>)
                    ) : (
                      <option value="">--</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-sm font-medium text-slate-700">ถึงเดือน</label>
                <div className="flex gap-2">
                  <select className="glass-input flex-1 bg-white/70" value={toMonth} onChange={(e) => setToMonth(e.target.value)}>
                    {availableMonths.length > 0 ? (
                      availableMonths.map(m => <option key={m} value={m}>{m}</option>)
                    ) : (
                      <option value="">(ไม่มีข้อมูล)</option>
                    )}
                  </select>
                  <select className="glass-input w-1/3 bg-white/70" value={toYear} onChange={(e) => setToYear(e.target.value)}>
                    {availableYears.length > 0 ? (
                      availableYears.map(y => <option key={y} value={y}>{y}</option>)
                    ) : (
                      <option value="">--</option>
                    )}
                  </select>
                </div>
              </div>
            </div>

            <button type="submit" disabled={isLoading || availableMonths.length === 0} className="btn-primary w-full flex items-center justify-center gap-2 mt-8">
              {isLoading ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Search className="w-5 h-5" />}
              {isLoading ? 'กำลังค้นหา...' : 'ค้นหาใบรับรองการจ่ายเงินเดือน'}
            </button>
          </form>
        </div>

        {results && (
          <div className="space-y-4">
            {employeeData && (
              <div className="mb-4 text-center w-full">
                <div className="inline-flex flex-col sm:flex-row items-center gap-1 sm:gap-2 px-6 py-3 bg-emerald-50/80 border border-emerald-100 rounded-2xl shadow-sm backdrop-blur-sm">
                  <span className="text-emerald-800 font-medium whitespace-nowrap">ใบรับรองการจ่ายเงินเดือนของ</span>
                  <span className="text-emerald-900 font-bold whitespace-nowrap">{employeeData.name}</span>
                  <span className="text-emerald-800 font-medium whitespace-nowrap hidden sm:inline">ตำแหน่ง</span>
                  <span className="text-emerald-900 font-bold whitespace-nowrap sm:hidden">ตำแหน่ง {employeeData.position}</span>
                  <span className="text-emerald-900 font-bold whitespace-nowrap hidden sm:inline">{employeeData.position}</span>
                </div>
              </div>
            )}
            <h2 className="text-xl font-semibold mb-4 text-slate-700">ผลการค้นหา ({results.length} รายการ)</h2>
            {results.length > 0 ? (
              results.map((result, idx) => (
                <div key={idx} className="glass-panel p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 hover:bg-white/60 transition-colors cursor-pointer group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800">ใบรับรองการจ่ายเงินเดือน ประจำเดือน {result.month}</p>
                      <p className="text-sm text-slate-500">พ.ศ. {result.year}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                    <button 
                      type="button"
                      onClick={() => handleView(result.pdf_base64, result.month, result.year)}
                      className="flex items-center justify-center flex-1 sm:flex-none gap-1.5 text-sm font-medium bg-white hover:bg-slate-50 text-slate-700 hover:text-emerald-700 px-3.5 py-2 rounded-xl transition-colors border border-slate-200 shadow-sm"
                      title="ดูไฟล์"
                    >
                      <Eye className="w-4 h-4 text-emerald-600" />
                      <span>ดูไฟล์</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleDownload(result.pdf_base64, result.month, result.year)}
                      className="flex items-center justify-center flex-1 sm:flex-none gap-1.5 text-sm font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3.5 py-2 rounded-xl transition-colors border border-emerald-200 shadow-sm"
                    >
                      <Download className="w-4 h-4" />
                      <span>ดาวน์โหลด</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="glass-panel p-8 text-center text-slate-500 flex flex-col items-center">
                <AlertCircle className="w-12 h-12 mb-4 text-slate-400" />
                <p className="text-sm sm:text-base text-slate-500 max-w-md mx-auto leading-relaxed">
                  ไม่พบข้อมูลสลิปเงินเดือนในช่วงเวลาที่เลือก<br/>
                  <span className="text-xs sm:text-sm mt-1 inline-block">โปรดตรวจสอบเลขบัญชีธนาคารอีกครั้ง หรือคุณอาจไม่มีประวัติรับเงินเดือนในเดือนดังกล่าว</span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin Password Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setShowAdminModal(false)}
          />
          <div className="glass-panel p-6 w-full max-w-sm relative z-10 bg-white/90">
            <button 
              onClick={() => setShowAdminModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="text-center mb-6 mt-2">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-600">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">เข้าสู่ระบบผู้ดูแล</h3>
              <p className="text-sm text-slate-500 mt-1">กรุณาใส่รหัสผ่านเพื่อจัดการฐานข้อมูล</p>
            </div>

            <form onSubmit={handleAdminLogin}>
              <input
                type="password"
                placeholder="รหัสผ่าน"
                required
                className="glass-input w-full bg-white mb-4"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
              
              {adminError && (
                <div className="mb-4 text-sm text-rose-500 flex items-center justify-center gap-1.5 bg-rose-50 p-2 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  <span>{adminError}</span>
                </div>
              )}
              
              <button type="submit" disabled={isCheckingAuth} className="btn-primary w-full flex justify-center items-center gap-2">
                {isCheckingAuth ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'เข้าสู่ระบบ'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {previewModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6">
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closePreviewModal}
          />
          <div className="glass-panel w-full max-w-4xl max-h-[92vh] flex flex-col relative z-10 bg-white shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm sm:text-base leading-tight">
                    ใบรับรองการจ่ายเงินเดือน ประจำเดือน {previewModal.month} {previewModal.year}
                  </h3>
                  {employeeData && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {employeeData.name} {employeeData.position ? `(${employeeData.position})` : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={previewModal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-emerald-700 bg-white hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors"
                  title="เปิดในแท็บใหม่"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>เปิดแท็บใหม่</span>
                </a>
                <button
                  type="button"
                  onClick={() => handleDownload(previewModal.pdfBase64, previewModal.month, previewModal.year)}
                  className="flex items-center gap-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>ดาวน์โหลด</span>
                </button>
                <button 
                  type="button"
                  onClick={closePreviewModal}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors ml-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: PDF Preview */}
            <div className="flex-1 w-full p-2 md:p-4 bg-slate-100 overflow-hidden flex flex-col">
              <iframe
                src={`${previewModal.url}#toolbar=0`}
                className="w-full h-[65vh] md:h-[72vh] rounded-xl border border-slate-200 bg-white shadow-inner"
                title={`สลิปเงินเดือน ${previewModal.month} ${previewModal.year}`}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
