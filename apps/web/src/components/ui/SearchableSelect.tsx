import { useState, useRef, useEffect, useMemo } from "react";

export type SelectOption = {
  value: string;
  label: string;
  sublabel?: string;
};

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "-- Pilih --",
  searchPlaceholder = "Cari...",
  disabled = false,
  className = "",
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  }, [options, search]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (!isOpen) {
      setSearch("");
    }
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Select Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-xl border transition-all text-left bg-[var(--input-bg,var(--surface))] text-[var(--fg)] border-[var(--input-border,var(--hover))]"
        style={{
          borderColor: isOpen ? "var(--primary)" : "var(--input-border)",
          boxShadow: isOpen ? "0 0 0 3px rgba(14, 165, 233, 0.15)" : "none",
        }}
      >
        <span className={`truncate ${!selectedOption ? "text-slate-400" : ""}`}>
          {selectedOption
            ? `${selectedOption.label} ${selectedOption.sublabel ? `(${selectedOption.sublabel})` : ""}`
            : placeholder}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-72 flex flex-col rounded-xl border shadow-xl bg-[var(--surface,#ffffff)] border-[var(--hover,#e2e8f0)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            backgroundColor: "var(--surface, #ffffff)",
            borderColor: "var(--hover, #cbd5e1)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          }}
        >
          {/* Search Bar */}
          <div className="p-2 border-b border-[var(--hover,#e2e8f0)] bg-[var(--surface,#ffffff)]">
            <div className="relative">
              <svg
                className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-[var(--input-bg,#f8fafc)] text-[var(--fg)] border-[var(--input-border,#cbd5e1)] focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Options List */}
          <div className="overflow-y-auto max-h-56 p-1">
            <button
              type="button"
              onClick={() => handleSelect("")}
              className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors flex items-center justify-between ${
                value === ""
                  ? "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 font-medium"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <span>{placeholder}</span>
              {value === "" && (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center text-slate-400">
                Tidak ada data ditemukan
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors flex items-center justify-between ${
                      isSelected
                        ? "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400 font-medium"
                        : "text-[var(--fg)] hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="truncate">
                      <span>{opt.label}</span>
                      {opt.sublabel && (
                        <span className="ml-1.5 text-slate-400 font-normal">
                          ({opt.sublabel})
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <svg className="w-3.5 h-3.5 shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
