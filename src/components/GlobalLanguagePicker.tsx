import { useMemo, useState } from 'react';
import { ChevronDown, Globe2, Loader2, Search, Sparkles, X } from 'lucide-react';
import {
  GLOBAL_WORKFORCE_LANGUAGES,
  type GlobalLanguageOption,
} from '../shared/globalLanguages';

interface GlobalLanguagePickerProps {
  activeGlobalLang: GlobalLanguageOption | null;
  translating: boolean;
  onSelectGlobalLanguage: (lang: GlobalLanguageOption) => void;
  onClearGlobalLanguage?: () => void;
}

const REGIONS: Array<'All' | GlobalLanguageOption['region']> = [
  'All',
  'South Asia',
  'Middle East & North Africa',
  'Southeast Asia',
  'East & West Africa',
  'East & Central Asia',
  'Europe & CIS',
  'Americas',
];

export function GlobalLanguagePicker({
  activeGlobalLang,
  translating,
  onSelectGlobalLanguage,
  onClearGlobalLanguage,
}: GlobalLanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<'All' | GlobalLanguageOption['region']>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GLOBAL_WORKFORCE_LANGUAGES.filter((lang) => {
      if (region !== 'All' && lang.region !== region) return false;
      if (!q) return true;
      return (
        lang.name.toLowerCase().includes(q) ||
        lang.nativeName.toLowerCase().includes(q) ||
        lang.code.toLowerCase().includes(q) ||
        lang.region.toLowerCase().includes(q)
      );
    });
  }, [query, region]);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="global-language-picker-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeGlobalLang
              ? 'bg-[#787aff]/20 border-[#787aff] text-white'
              : 'bg-[#0c111d] border-white/15 text-slate-200 hover:border-[#787aff]/60'
          }`}
        >
          {translating ? (
            <Loader2 className="w-3.5 h-3.5 text-[#a5a7ff] animate-spin" />
          ) : (
            <Globe2 className="w-3.5 h-3.5 text-[#787aff]" />
          )}
          <span>
            {activeGlobalLang
              ? `${activeGlobalLang.nativeName} (${activeGlobalLang.name})`
              : `${GLOBAL_WORKFORCE_LANGUAGES.length}+ Global Languages`}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {activeGlobalLang && onClearGlobalLanguage && (
          <button
            type="button"
            onClick={() => {
              onClearGlobalLanguage();
              setOpen(false);
            }}
            aria-label="Reset to core quick language"
            className="p-1.5 rounded-lg bg-[#0c111d] border border-white/10 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          data-testid="global-language-drawer"
          className="mt-3 rounded-2xl bg-[#0c111d] border border-[#787aff]/40 p-3.5 shadow-2xl space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Sparkles className="w-3.5 h-3.5 text-[#787aff]" />
              <span>
                Abu Dhabi / UAE Global Workforce Translator ({GLOBAL_WORKFORCE_LANGUAGES.length}{' '}
                Languages via Gemini)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              data-testid="global-language-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 114 languages (e.g. Telugu, Persian, Swahili, French, Mandarin, Punjabi...)"
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#141821] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#787aff]"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {REGIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegion(r)}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  region === r
                    ? 'bg-[#787aff] text-white font-semibold'
                    : 'bg-[#141821] text-slate-400 hover:text-white border border-white/8'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="max-h-56 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 pr-1">
            {filtered.map((item) => {
              const isSelected = activeGlobalLang?.code === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  data-testid={`global-lang-${item.code}`}
                  disabled={translating}
                  onClick={() => {
                    onSelectGlobalLanguage(item);
                    setOpen(false);
                  }}
                  className={`px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#787aff]/25 border-[#787aff] text-white'
                      : 'bg-[#141821] border-white/8 hover:border-[#787aff]/45 text-slate-200'
                  }`}
                >
                  <div className="text-xs font-semibold truncate">{item.nativeName}</div>
                  <div className="text-[10px] text-slate-400 truncate font-mono">
                    {item.name} · {item.code}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full py-4 text-center text-xs text-slate-400">
                No matching language found for "{query}".
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
