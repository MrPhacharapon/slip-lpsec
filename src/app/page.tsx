"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, FileText, AlertCircle, Settings, X, Lock, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const ALL_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

type SlipResult = { month: string; year: string; name?: string };

export default function Home() {
  const router = useRouter();
  
  const [bankAccount, setBankAccount] = useState("");
  const [resultAccount, setResultAccount] = useState("");
  const searchId = useRef(0);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [showBankAccount, setShowBankAccount] = useState(false);
  
  const [fromMonth, setFromMonth] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [toYear, setToYear] = useState("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<SlipResult[] | null>(null);
  const [employeeData, setEmployeeData] = useState<{name: string, position: string} | null>(null);

  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);

  const fetchAvailablePeriods = useCallback(async () => {
    try {
      const response = await fetch('/api/payroll/periods', { cache: 'no-store' });
      const data = (await response.json()).periods as Array<{ month: string; year: string }>;
      const error = response.ok ? null : new Error('โหลดช่วงเวลาไม่สำเร็จ');
      
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
    } catch (err: unknown) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchAvailablePeriods(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchAvailablePeriods]);

  const requestPdf = async (month: string, year: string): Promise<Blob> => {
    const res = await fetch("/api/payroll/pdf", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankAccount: resultAccount, month, year }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error("ไม่สามารถโหลด PDF ได้");
    return res.blob();
  };

  const handleView = async (month: string, year: string) => {
    // Open the tab on the user's click so browser popup protection does not
    // suppress it during the asynchronous PDF request.
    const tab = window.open("", "_blank");
    try {
      const blob = await requestPdf(month, year);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.assign(url);
      else window.location.assign(url);
    } catch {
      tab?.close();
      alert("ไม่สามารถเปิดดูไฟล์ได้");
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const account = bankAccount.trim();
    if (!account) return;
    const requestId = ++searchId.current;

    setIsLoading(true);
    setResults(null);
    setResultAccount("");
    try {
      if (!/^\d{10}$/.test(account)) throw new Error('เลขบัญชีต้องมี 10 หลัก');
      const response = await fetch('/api/payroll/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccount: account }), cache: 'no-store',
      });
      if (!response.ok) throw new Error('ไม่สามารถค้นหาสลิปได้');
      const payload = await response.json();
      const data = payload.results as Array<{month: string; year: string; name?: string}>;
      const employee = payload.employee as {name: string; position: string} | null;
      
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
      
      if (requestId !== searchId.current) return;
      setResultAccount(account);
      setResults(filteredData);
      setEmployeeData(employee);



    } catch (error) {
      if (requestId === searchId.current) {
        console.error("Search error:", error);
        alert("เกิดข้อผิดพลาดในการค้นหา");
      }
    } finally {
      if (requestId === searchId.current) setIsLoading(false);
    }
  };

  const handleDownload = async (month: string, year: string) => {
    try {
      const blob = await requestPdf(month, year);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `slip_${month}_${year}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
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
        router.push("/admin");
      } else {
        setAdminError(data.error || "รหัสผ่านไม่ถูกต้อง");
      }
    } catch {
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
          <Image
            src="https://i.postimg.cc/8kKrvnfY/removebg-preview.png"
            alt="โลโก้ศูนย์การศึกษาพิเศษ ประจำจังหวัดลำปาง"
            width={96}
            height={96}
            unoptimized
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
                  onChange={(e) => {
                    searchId.current += 1;
                    setBankAccount(e.target.value);
                    setResults(null);
                    setResultAccount("");
                    setEmployeeData(null);
                    setIsLoading(false);
                  }}
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
                <div className="inline-flex flex-wrap items-center justify-center gap-1.5 px-4 sm:px-6 py-2.5 sm:py-3 bg-emerald-50/90 border border-emerald-200/70 rounded-2xl shadow-xs backdrop-blur-sm">
                  <span className="text-emerald-800 text-xs sm:text-sm font-medium">ใบรับรองการจ่ายเงินเดือนของ</span>
                  <span className="text-emerald-950 text-sm sm:text-base font-bold">{employeeData.name}</span>
                  {employeeData.position && (
                    <span className="text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full text-xs font-semibold ml-1">
                      ตำแหน่ง {employeeData.position}
                    </span>
                  )}
                </div>
              </div>
            )}
            <h2 className="text-lg sm:text-xl font-bold mb-3 px-1 text-slate-800">ผลการค้นหา ({results.length} รายการ)</h2>
            {results.length > 0 ? (
              results.map((result, idx) => (
                <div 
                  key={idx} 
                  className="glass-panel p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 hover:bg-white/80 transition-all duration-200 shadow-xs hover:shadow-md rounded-2xl border border-slate-200/70"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-emerald-100/90 flex items-center justify-center text-emerald-600 shrink-0 shadow-inner">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 text-sm sm:text-base leading-snug">
                        ใบรับรองการจ่ายเงินเดือน ประจำเดือน {result.month}
                      </p>
                      <p className="text-xs sm:text-sm text-slate-500 mt-0.5 font-medium">
                        พ.ศ. {result.year}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-100/80 justify-end">
                    <button 
                      type="button"
                      onClick={() => handleView(result.month, result.year)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs sm:text-sm font-medium bg-white hover:bg-emerald-50/80 text-slate-700 hover:text-emerald-700 px-4 py-2.5 sm:py-2 rounded-xl transition-all border border-slate-200 shadow-xs hover:border-emerald-300 active:scale-[0.98] cursor-pointer"
                      title="ดูไฟล์เต็มจอในแท็บใหม่"
                    >
                      <Eye className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>ดูไฟล์</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => handleDownload(result.month, result.year)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs sm:text-sm font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-700 hover:text-emerald-800 px-4 py-2.5 sm:py-2 rounded-xl transition-all border border-emerald-200 shadow-xs hover:border-emerald-300 active:scale-[0.98] cursor-pointer"
                      title="ดาวน์โหลดไฟล์ PDF"
                    >
                      <Download className="w-4 h-4 shrink-0" />
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
    </main>
  );
}
