/**
 * Standard sorting utilities for SINTESA dropdowns and lists.
 * Ensures natural and intuitive ordering for Roman numeral classes,
 * alphabetical subjects, teachers, academic years, and teaching hours.
 */

const ROMAN_NUMERALS: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

export function parseClassRank(rawName: string): { level: number; remainder: string } {
  if (!rawName) return { level: 9999, remainder: "" };
  const clean = rawName.replace(/^(kelas|class)\s+/i, "").trim();

  // Match Roman numerals (XII, XI, X, VIII, VII, IX, VI, V, IV, III, II, I) or numbers 1-12
  const match = clean.match(/^(XII|XI|X|VIII|VII|IX|VI|V|IV|III|II|I|12|11|10|[1-9])([ -_./\\]*.*)$/i);
  if (match) {
    const rawLevel = match[1].toUpperCase();
    const level = ROMAN_NUMERALS[rawLevel] ?? parseInt(rawLevel, 10);
    const remainder = (match[2] || "").trim();
    return { level: isNaN(level) ? 999 : level, remainder };
  }

  // Non-grade classes (Simulasi, Alumni, etc.) go to the end
  return { level: 9999, remainder: clean };
}

export function compareClassNames(
  a: string | { name?: string | null; nama_kelas?: string | null } | null | undefined,
  b: string | { name?: string | null; nama_kelas?: string | null } | null | undefined
): number {
  const nameA = typeof a === "string" ? a : a?.name || a?.nama_kelas || "";
  const nameB = typeof b === "string" ? b : b?.name || b?.nama_kelas || "";

  const rankA = parseClassRank(nameA);
  const rankB = parseClassRank(nameB);

  if (rankA.level !== rankB.level) {
    return rankA.level - rankB.level;
  }

  return rankA.remainder.localeCompare(rankB.remainder, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortClasses<T>(
  list: T[],
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const nameA = getName ? getName(a) : typeof a === "string" ? a : (a as any)?.name ?? (a as any)?.nama_kelas;
    const nameB = getName ? getName(b) : typeof b === "string" ? b : (b as any)?.name ?? (b as any)?.nama_kelas;
    return compareClassNames(nameA, nameB);
  });
}

export function compareByName(
  a: string | { name?: string | null; nama?: string | null; nama_lengkap?: string | null } | null | undefined,
  b: string | { name?: string | null; nama?: string | null; nama_lengkap?: string | null } | null | undefined
): number {
  const nameA = typeof a === "string" ? a : a?.name ?? a?.nama ?? a?.nama_lengkap ?? "";
  const nameB = typeof b === "string" ? b : b?.name ?? b?.nama ?? b?.nama_lengkap ?? "";
  return nameA.localeCompare(nameB, "id", { numeric: true, sensitivity: "base" });
}

export function sortSubjects<T>(
  list: T[],
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const nameA = getName ? getName(a) : typeof a === "string" ? a : (a as any)?.name ?? (a as any)?.subjectName;
    const nameB = getName ? getName(b) : typeof b === "string" ? b : (b as any)?.name ?? (b as any)?.subjectName;
    return compareByName(nameA, nameB);
  });
}

export function sortTeachers<T>(
  list: T[],
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const nameA = getName ? getName(a) : typeof a === "string" ? a : (a as any)?.name ?? (a as any)?.userName ?? (a as any)?.nama_lengkap;
    const nameB = getName ? getName(b) : typeof b === "string" ? b : (b as any)?.name ?? (b as any)?.userName ?? (b as any)?.nama_lengkap;
    return compareByName(nameA, nameB);
  });
}

export function sortAcademicYears<T>(
  list: T[],
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const activeA = Boolean((a as any)?.isActive ?? (a as any)?.is_active);
    const activeB = Boolean((b as any)?.isActive ?? (b as any)?.is_active);
    if (activeA !== activeB) {
      return activeA ? -1 : 1; // Active first
    }
    const nameA = typeof a === "string" ? a : getName ? getName(a) : (a as any)?.name;
    const nameB = typeof b === "string" ? b : getName ? getName(b) : (b as any)?.name;
    return String(nameB ?? "").localeCompare(String(nameA ?? ""), undefined, { numeric: true });
  });
}

export function sortTeachingHours<T>(list: T[]): T[] {
  return [...list].sort((a: any, b: any) => {
    const timeA = a?.startTime ?? a?.start_time ?? "";
    const timeB = b?.startTime ?? b?.start_time ?? "";
    if (timeA && timeB && timeA !== timeB) {
      return timeA.localeCompare(timeB, undefined, { numeric: true });
    }
    const labelA = a?.label ?? "";
    const labelB = b?.label ?? "";
    return labelA.localeCompare(labelB, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function sortStudents<T>(
  list: T[],
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const nameA = getName ? getName(a) : typeof a === "string" ? a : (a as any)?.name ?? (a as any)?.studentName;
    const nameB = getName ? getName(b) : typeof b === "string" ? b : (b as any)?.name ?? (b as any)?.studentName;
    return compareByName(nameA, nameB);
  });
}

export function sortStudentsByClassThenName<T>(
  list: T[],
  getClassName?: (item: T) => string | undefined | null,
  getName?: (item: T) => string | undefined | null
): T[] {
  return [...list].sort((a, b) => {
    const classA = getClassName ? getClassName(a) : (a as any)?.className ?? (a as any)?.class_name;
    const classB = getClassName ? getClassName(b) : (b as any)?.className ?? (b as any)?.class_name;
    const classCmp = compareClassNames(classA, classB);
    if (classCmp !== 0) return classCmp;

    const nameA = getName ? getName(a) : typeof a === "string" ? a : (a as any)?.name ?? (a as any)?.studentName;
    const nameB = getName ? getName(b) : typeof b === "string" ? b : (b as any)?.name ?? (b as any)?.studentName;
    return compareByName(nameA, nameB);
  });
}

