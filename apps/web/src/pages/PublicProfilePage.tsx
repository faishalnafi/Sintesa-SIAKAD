import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

function computeMD5(str: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    }
    return lResult ^ lX8 ^ lY8;
  }
  function F(x: number, y: number, z: number) { return (x & y) | ((~x) & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & (~z)); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | (~z)); }
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(string: string) {
    let lWordCount;
    const lMessageLength = string.length;
    const lNumberOfWordsTemp1 = lMessageLength + 8;
    const lNumberOfWordsTemp2 = (lNumberOfWordsTemp1 - (lNumberOfWordsTemp1 % 64)) / 64;
    const lNumberOfWords = (lNumberOfWordsTemp2 + 1) * 16;
    const lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue: number) {
    let WordToHexValue = "", WordToHexValueTemp = "", lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
      lByte = (lValue >>> (lCount * 8)) & 255;
      WordToHexValueTemp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValueTemp.substr(WordToHexValueTemp.length - 2, 2);
    }
    return WordToHexValue;
  }
  const xArr = convertToWordArray(str.toLowerCase().trim());
  let k, AA, BB, CC, DD, a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;
  for (k = 0; k < xArr.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = FF(a, b, c, d, xArr[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, xArr[k + 1], S12, 0xE8C7B756); c = FF(c, d, a, b, xArr[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, xArr[k + 3], S14, 0xC1BDCEEE);
    a = FF(a, b, c, d, xArr[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, xArr[k + 5], S12, 0x4787C62A); c = FF(c, d, a, b, xArr[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, xArr[k + 7], S14, 0xFD469501);
    a = FF(a, b, c, d, xArr[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, xArr[k + 9], S12, 0x8B44F7AF); c = FF(c, d, a, b, xArr[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, xArr[k + 11], S14, 0x895CD7BE);
    a = FF(a, b, c, d, xArr[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, xArr[k + 13], S12, 0xFD987193); c = FF(c, d, a, b, xArr[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, xArr[k + 15], S14, 0x49B40821);
    a = GG(a, b, c, d, xArr[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, xArr[k + 6], S22, 0xC040B340); c = GG(c, d, a, b, xArr[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, xArr[k + 0], S24, 0xE9B6C7AA);
    a = GG(a, b, c, d, xArr[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, xArr[k + 10], S22, 0x2441453); c = GG(c, d, a, b, xArr[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, xArr[k + 4], S24, 0xE7D3FBC8);
    a = GG(a, b, c, d, xArr[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, xArr[k + 14], S22, 0xC33707D6); c = GG(c, d, a, b, xArr[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, xArr[k + 8], S24, 0x455A14ED);
    a = GG(a, b, c, d, xArr[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, xArr[k + 2], S22, 0xFCEFA3F8); c = GG(c, d, a, b, xArr[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, xArr[k + 12], S24, 0x8D2A4C8A);
    a = HH(a, b, c, d, xArr[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, xArr[k + 8], S32, 0x8771F681); c = HH(c, d, a, b, xArr[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, xArr[k + 14], S34, 0xFDE5380C);
    a = HH(a, b, c, d, xArr[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, xArr[k + 4], S32, 0x4BDECFA9); c = HH(c, d, a, b, xArr[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, xArr[k + 10], S34, 0xBEBFBC70);
    a = HH(a, b, c, d, xArr[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, xArr[k + 0], S32, 0xEAA127FA); c = HH(c, d, a, b, xArr[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, xArr[k + 2], S34, 0x4881D05E);
    a = HH(a, b, c, d, xArr[k + 6], S31, 0xD9D4D039); d = HH(d, a, b, c, xArr[k + 9], S32, 0xE6D16821); c = HH(c, d, a, b, xArr[k + 12], S33, 0x214614A3); b = HH(b, c, d, a, xArr[k + 15], S34, 0xF8826E20);
    a = II(a, b, c, d, xArr[k + 0], S41, 0xF4292244); d = II(d, a, b, c, xArr[k + 7], S42, 0x432AFF97); c = II(c, d, a, b, xArr[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, xArr[k + 5], S44, 0xFC93A039);
    a = II(a, b, c, d, xArr[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, xArr[k + 3], S42, 0x8F0CCC92); c = II(c, d, a, b, xArr[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, xArr[k + 1], S44, 0x85845DD1);
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

type AssessmentComponent = {
  id: string;
  code: string;
  name: string;
  type: "UJIAN" | "TUGAS";
  status: "active" | "disabled" | "inactive";
  sortOrder: number;
};

type ProfileData = {
  student: {
    id: string;
    name: string;
    nisn: string | null;
    kelasLabel: string | null;
    poinGds: number;
    sakit: number;
    izin: number;
    alpa: number;
    username: string | null;
    email?: string | null;
    avatarUrl: string | null;
    location: string;
    nickname: string;
    jenjang: string;
    rombel: string;
    socialLinks: {
      github: string;
      gitlab: string;
      linkedin: string;
      x: string;
    };
  };
  grades: Array<{
    subjectName: string;
    uh1: string | null;
    t1: string | null;
    sts: string | null;
    uh2: string | null;
    t2: string | null;
    status: string;
  }>;
  assessmentComponents: AssessmentComponent[];
  availableYears: string[];
  selectedYear: string;
};

/** KKM helper */
function getKkm(className: string | null | undefined): number {
  if (!className) return 80;
  const upper = className.toUpperCase();
  if (/\bXII\b|12/.test(upper)) return 82;
  if (/\bXI\b|11/.test(upper)) return 81;
  if (/\bX\b|10/.test(upper)) return 80;
  return 80;
}

const renderKkmIndicator = (
  val: string | number | null,
  kkm: number,
  compStatus: "active" | "disabled" | "inactive" = "active"
) => {
  if (compStatus === "disabled") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs"
        title="Segera Hadir"
      >
        –
      </span>
    );
  }

  if (val === null || val === undefined || val === "") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold text-sm"
        title="Belum Terisi"
      >
        ✗
      </span>
    );
  }
  const numeric = Number(val);
  const tuntas = !isNaN(numeric) && numeric >= kkm;
  return tuntas ? (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-sm"
      title={`Tuntas (${numeric} ≥ KKM ${kkm})`}
    >
      ✓
    </span>
  ) : (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold text-sm"
      title={`Tidak Tuntas (${numeric} < KKM ${kkm})`}
    >
      ✗
    </span>
  );
};

export function PublicProfilePage() {
  const { uuid } = useParams<{ uuid: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (year?: string) => {
    setLoading(true);
    try {
      const url = `/public/profile/${uuid}${year ? `?academicYear=${encodeURIComponent(year)}` : ""}`;
      const res = await api<ProfileData>(url);
      if (res.data) {
        setData(res.data);
        if (!selectedYear) {
          setSelectedYear(res.data.selectedYear);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat profil");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (uuid) {
      fetchProfile(selectedYear);
    }
  }, [uuid, selectedYear]);

  const handleShare = async () => {
    const url = window.location.href;

    const showToast = () => {
      Swal.fire({
        icon: "success",
        title: "Tautan Disalin!",
        text: url,
        timer: 2000,
        showConfirmButton: false,
        toast: true,
        position: "top-end",
      });
    };

    // Coba ClipboardItem dengan explicit MIME type (lebih proper, dikenali Windows Clipboard History)
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        const item = new ClipboardItem({
          "text/plain": new Blob([url], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
        showToast();
        return;
      }
    } catch {
      // fallthrough ke writeText
    }

    // Fallback: writeText biasa
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast();
        return;
      }
    } catch {
      // fallthrough ke execCommand
    }

    // Last resort: execCommand
    try {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      showToast();
    } catch (e) {
      console.error("Gagal menyalin URL", e);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--surface-container-lowest)" }}>
        <Card className="p-8 max-w-md w-full text-center space-y-4">
          <span className="material-symbols-outlined text-[64px] text-rose-500">error</span>
          <h1 className="font-display text-xl font-bold">Profil Tidak Ditemukan</h1>
          <p className="text-sm text-on-surface-variant">{error}</p>
        </Card>
      </div>
    );
  }

  const student = data?.student;
  const kkm = getKkm(student?.rombel);
  const visibleComponents = data?.assessmentComponents.filter((c) => c.status !== "inactive") || [];

  return (
    <div className="min-h-screen py-8 px-4 md:px-8 space-y-6" style={{ background: "var(--surface-container-lowest)", color: "var(--on-surface)" }}>
      {loading && !data ? (
        <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-6">
          <Card className="p-6 space-y-4 h-fit">
            <Skeleton className="h-28 w-28 rounded-full mx-auto" />
            <Skeleton className="h-6 w-3/4 mx-auto" />
            <Skeleton className="h-4 w-1/2 mx-auto" />
          </Card>
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      ) : (
        student && (
          <div className="max-w-6xl mx-auto grid lg:grid-cols-3 gap-6">
            {/* Sisi Kiri - Card Profil */}
            <Card className="p-6 flex flex-col justify-between h-fit relative border border-outline-variant/30 shadow-md">
              <div className="absolute top-4 right-4 bg-primary/10 text-primary text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">
                Profil publik
              </div>

              <div className="space-y-6 text-center lg:text-left">
                {/* Avatar */}
                <div className="flex justify-center lg:justify-start pt-4">
                  <img
                    src={
                      student.avatarUrl ||
                      `https://www.gravatar.com/avatar/${computeMD5(
                        student.email || student.username || student.id || student.name
                      )}?d=identicon&s=250`
                    }
                    alt={student.name}
                    className="w-28 h-28 rounded-full object-cover ring-4 ring-primary/20 shadow-lg bg-surface-container-high"
                    onError={(e) => {
                      const target = e.currentTarget;
                      target.onerror = null;
                      target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(student.id)}`;
                    }}
                  />
                </div>

                {/* Identity */}
                <div className="space-y-1">
                  <h2 className="font-display font-bold text-xl md:text-2xl tracking-tight leading-tight">
                    {student.name}
                  </h2>
                  <p className="text-sm text-primary font-medium font-mono">
                    {student.username && student.username !== student.nisn ? student.username : "—"}
                  </p>
                </div>

                {/* Detail Akademik */}
                <div className="space-y-3 pt-2 border-t border-outline-variant/20">
                  <span className="text-[10px] font-bold text-on-surface-variant tracking-wider uppercase block">Detail Akademik</span>
                  <div className="space-y-2.5">
                    <div>
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider block font-bold">UUID</span>
                      <span className="font-mono text-xs font-semibold block break-all select-all">{student.id}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider block font-bold">NISN</span>
                      <span className="text-xs font-semibold block">{student.nisn ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider block font-bold">JENJANG</span>
                      <span className="text-xs font-semibold block">{student.jenjang}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-on-surface-variant uppercase tracking-wider block font-bold">ROMBEL</span>
                      <span className="text-xs font-semibold block">{student.rombel}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Share Icon Only */}
              <div className="flex justify-end pt-6 border-t border-outline-variant/20 mt-6">
                <button
                  onClick={handleShare}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-high hover:bg-primary hover:text-white transition-all text-on-surface-variant shadow-sm border border-outline-variant/30"
                  title="Bagikan Profil"
                >
                  <span className="material-symbols-outlined text-[20px]">share</span>
                </button>
              </div>
            </Card>

            {/* Sisi Kanan - Akademik detail */}
            <div className="lg:col-span-2 space-y-6">


              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Poin GDS", value: student.poinGds, icon: "stars", color: "text-primary bg-primary/10" },
                  { label: "Sakit", value: student.sakit, icon: "medical_services", color: "text-amber-500 bg-amber-500/10" },
                  { label: "Izin", value: student.izin, icon: "event_available", color: "text-emerald-500 bg-emerald-500/10" },
                  { label: "Alpa", value: student.alpa, icon: "person_off", color: "text-rose-500 bg-rose-500/10" },
                ].map((s) => (
                  <Card key={s.label} className="p-4 flex flex-col justify-between border border-outline-variant/30 shadow-sm">
                    <div className="flex items-center gap-2 text-on-surface-variant text-xs font-medium">
                      <span className={`p-1.5 rounded-lg ${s.color}`}>
                        <span className="material-symbols-outlined text-[16px] block">{s.icon}</span>
                      </span>
                      {s.label}
                    </div>
                    <div className="font-display text-3xl font-extrabold mt-3 text-primary">
                      {data?.grades && data.grades.length > 0 ? (s.value ?? "–") : "–"}
                    </div>
                  </Card>
                ))}
              </div>

              {/* Tabel Raport Nilai */}
              <Card className="overflow-hidden border border-outline-variant/30 shadow-md">
                <div className="p-4 md:p-6 bg-surface border-b border-outline-variant/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-display font-bold text-lg">Raport &amp; Status Ketuntasan Nilai</h3>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Berdasarkan KKM <span className="font-semibold text-primary">{student.rombel} (KKM {kkm})</span> — ✓ Tuntas / ✗ Tidak Tuntas / – Segera Hadir
                    </p>
                  </div>

                  {/* Dropdown Tahun Pelajaran */}
                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <span className="text-xs font-medium text-on-surface-variant whitespace-nowrap">Tahun Pelajaran:</span>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="text-xs rounded-xl border border-outline-variant/40 bg-surface px-3 py-2 outline-none focus:border-primary font-medium"
                    >
                      {data?.availableYears.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-surface-container/80 dark:bg-white/5">
                      <tr>
                        <th className="px-6 py-3.5 font-semibold text-on-surface-variant">Mata Pelajaran</th>
                        {visibleComponents.map((c) => (
                          <th key={c.code} className="px-4 py-3.5 font-semibold text-center uppercase text-on-surface-variant">
                            {c.code}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <tr key={i}>
                            <td colSpan={1 + visibleComponents.length} className="px-6 py-4">
                              <Skeleton className="h-6 w-full" />
                            </td>
                          </tr>
                        ))
                      ) : data?.grades.length === 0 ? (
                        <tr>
                          <td colSpan={1 + visibleComponents.length} className="px-6 py-12 text-center text-on-surface-variant italic">
                            Belum ada data nilai raport yang disetujui pada tahun pelajaran ini.
                          </td>
                        </tr>
                      ) : (
                        data?.grades.map((g) => (
                          <tr key={g.subjectName} className="hover:bg-surface-container/30 transition-colors">
                            <td className="px-6 py-3.5 font-medium whitespace-nowrap">{g.subjectName}</td>
                            {visibleComponents.map((c) => {
                              const k = c.code.toLowerCase() as keyof typeof g;
                              return (
                                <td key={c.code} className="px-4 py-3.5 text-center">
                                  {renderKkmIndicator(g[k], kkm, c.status)}
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </div>
        )
      )}
    </div>
  );
}
