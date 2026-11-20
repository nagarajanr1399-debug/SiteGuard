import { NavLink } from 'react-router-dom';
import { useAbuDhabiClock } from '../hooks/useAbuDhabiClock';
import { formatTemperature, type TemperatureUnit } from '../shared/temperature';
import type { EnvironmentalObservation } from '../shared/types';
import { AnimatedMetric } from './PageTransition';

interface TopNavProps {
  env: EnvironmentalObservation | null;
  onChangeEnvMode: (
    mode: 'historical_heatwave' | 'live_abu_dhabi',
    hourGst?: number,
    simulateOffline?: boolean
  ) => void;
  envLoading: boolean;
  onOpenDemo: () => void;
  tempUnit: TemperatureUnit;
  onToggleTempUnit: () => void;
}

export function TopNav({
  env,
  onChangeEnvMode,
  envLoading,
  onOpenDemo,
  tempUnit,
  onToggleTempUnit,
}: TopNavProps) {
  const clock = useAbuDhabiClock();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap shrink-0 py-1.5 text-sm font-medium transition-all border-b-2 ${
      isActive
        ? 'border-[#787aff] text-white drop-shadow-[0_0_8px_rgba(120,122,255,0.45)]'
        : 'border-transparent text-slate-400 hover:text-slate-100 hover:border-[#787aff]/40'
    }`;

  const isEdgeOffline =
    env?.feedStatus === 'gemma4_edge_offline_mode' || Boolean(env?.edgeOfflineActive);
  const isLiveFeed = env?.mode === 'live_abu_dhabi' && !isEdgeOffline;

  return (
    <div className="no-print sticky top-0 z-30 bg-[#0B1120]/90 backdrop-blur-md border-b border-[#787aff]/20">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <NavLink
          to="/worker"
          className="text-xl font-bold tracking-tight text-[#787aff] whitespace-nowrap shrink-0 hover:brightness-110 transition-all"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SiteGuard
        </NavLink>

        <nav aria-label="Primary" className="flex items-center gap-6 overflow-x-auto">
          <NavLink to="/worker" className={linkClass}>
            Worker
          </NavLink>
          <NavLink to="/supervisor" className={linkClass}>
            Supervisor
          </NavLink>
          <NavLink to="/compliance" className={linkClass}>
            Compliance
          </NavLink>
          <NavLink to="/validation" className={linkClass}>
            Backtest
          </NavLink>
          <NavLink to="/forecast-validation" className={linkClass}>
            Forecast
          </NavLink>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenDemo}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#787aff] hover:bg-[#898bff] rounded-xl shadow-[0_0_18px_rgba(120,122,255,0.28)] transition-all active:scale-[0.99] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Demo Guide
          </button>
        </div>
      </header>

      {/* Environmental Feed & Data Provenance Telemetry Strip */}
      <div className="bg-[#141821]/85 border-t border-white/10">
        <div className="max-w-[1280px] mx-auto px-6 py-2 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-2.5">
            {env && (
              <span
                aria-live="polite"
                data-testid="feed-mode-indicator"
                title={env.resilienceReason ?? env.station}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold tracking-tight whitespace-nowrap ${
                  isEdgeOffline
                    ? 'bg-[#f59e0b]/15 border-[#f59e0b]/45 text-amber-200'
                    : isLiveFeed
                      ? 'bg-[#10b981]/15 border-[#10b981]/45 text-emerald-300'
                      : 'bg-[#17191d] border-white/15 text-slate-300'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-2 h-2 rounded-full ${
                    isEdgeOffline
                      ? 'bg-[#f59e0b] sg-tier-pulse-amber'
                      : isLiveFeed
                        ? 'bg-[#10b981] animate-pulse'
                        : 'bg-slate-400'
                  }`}
                />
                <span>
                  {isEdgeOffline
                    ? 'Gemma 4 Edge Offline Mode'
                    : isLiveFeed
                      ? 'Live Abu Dhabi Feed'
                      : 'Historical Calibration'}
                </span>
              </span>
            )}
            <span className="font-semibold text-slate-200">Data Provenance:</span>
            <span className="text-slate-300">
              Environmental: {env ? env.sourceLabel : 'Loading Abu Dhabi station...'}
            </span>
            {env?.mode === 'live_abu_dhabi' && (
              <span className="font-mono text-[11px] text-slate-400">
                (24.45°N, 54.38°E{env.provider ? ` · ${env.provider}` : ''})
              </span>
            )}
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-slate-400">
              Physiological: simulated, calibrated to ACGIH/NIOSH heat-stress thresholds
            </span>
          </div>

          {env && (
            <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-slate-300">
              <span
                data-testid="topnav-abudhabi-clock"
                title={clock.middayWindowStatusLabel}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-white/10 bg-[#0c111d] text-[11px] text-emerald-300"
              >
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>AUH {clock.timeWithSeconds} GST</span>
              </span>
              <span>
                Air {formatTemperature(env.airTempC, tempUnit, 1)} · RH {env.relHumidityPct}% · WBGT{' '}
                <strong className="text-white">
                  <AnimatedMetric value={formatTemperature(env.wbgtC, tempUnit, 1)} />
                </strong>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={tempUnit === 'F'}
                aria-label="Toggle temperature unit between Celsius and Fahrenheit"
                onClick={onToggleTempUnit}
                className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-[#0c111d] p-0.5 text-[11px] font-mono font-semibold text-slate-300 cursor-pointer whitespace-nowrap active:scale-[0.99]"
              >
                <span
                  className={`px-1.5 py-0.5 rounded-md transition-colors ${
                    tempUnit === 'C' ? 'bg-[#787aff] text-white' : 'text-slate-400'
                  }`}
                >
                  °C
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded-md transition-colors ${
                    tempUnit === 'F' ? 'bg-[#787aff] text-white' : 'text-slate-400'
                  }`}
                >
                  °F
                </span>
              </button>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <div className="flex items-center gap-1 bg-[#0c111d] border border-white/10 p-0.5 rounded-lg font-sans">
                <button
                  type="button"
                  disabled={envLoading}
                  onClick={() => onChangeEnvMode('historical_heatwave', env.hourGst, false)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                    env.mode === 'historical_heatwave'
                      ? 'bg-[#787aff] text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Heatwave CSV ({String(env.hourGst).padStart(2, '0')}:00)
                </button>
                <button
                  type="button"
                  disabled={envLoading}
                  onClick={() => onChangeEnvMode('live_abu_dhabi', undefined, false)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                    isLiveFeed
                      ? 'bg-[#10b981]/25 text-emerald-200 border border-[#10b981]/40'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Live Abu Dhabi
                </button>
                <button
                  type="button"
                  disabled={envLoading}
                  onClick={() => onChangeEnvMode('live_abu_dhabi', undefined, true)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all active:scale-[0.99] cursor-pointer whitespace-nowrap ${
                    isEdgeOffline
                      ? 'bg-[#f59e0b] text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Edge Offline
                </button>
              </div>
              {env.mode === 'historical_heatwave' && (
                <select
                  aria-label="Heatwave hour GST"
                  value={env.hourGst}
                  onChange={(e) => onChangeEnvMode('historical_heatwave', Number(e.target.value), false)}
                  className="bg-[#0c111d] border border-white/12 rounded-lg px-2 py-0.5 text-[11px] font-mono text-slate-100 cursor-pointer focus:outline-none focus:border-[#787aff]"
                >
                  {[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00 GST
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
