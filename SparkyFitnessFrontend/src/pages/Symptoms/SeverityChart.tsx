import { useTranslation } from 'react-i18next';
import type { SymptomEntryResponse } from '@workspace/shared';
import { usePreferences } from '@/contexts/PreferencesContext';

interface SeverityChartProps {
  entry: SymptomEntryResponse;
  /** Top of the y axis, from the symptom's scale. */
  max: number;
}

const W = 300;
const H = 130;
const PAD = { left: 26, right: 10, top: 10, bottom: 24 };

/**
 * Severity over the length of an episode, with a marker where each treatment was
 * taken so a drop in pain after a dose is easy to see. One scale places the
 * points, gridlines and labels.
 */
export default function SeverityChart({ entry, max }: SeverityChartProps) {
  const { t } = useTranslation();
  const { formatTime } = usePreferences();

  const startIso = entry.started_at ?? entry.logged_at;
  const points =
    entry.severity_timeline.length > 0
      ? entry.severity_timeline
      : entry.severity != null
        ? [{ at: startIso, severity: entry.severity }]
        : [];
  if (points.length === 0 || max <= 0) return null;

  const start = new Date(startIso).getTime();
  const lastPoint = Math.max(...points.map((p) => new Date(p.at).getTime()));
  // An episode still running ends at its latest reading (or 30 minutes after
  // the start when there is only one), so the chart never needs the clock.
  const end = entry.ended_at
    ? new Date(entry.ended_at).getTime()
    : Math.max(lastPoint, start + 30 * 60_000);
  const span = Math.max(end - start, 60_000);

  const x = (time: number) =>
    PAD.left + ((time - start) / span) * (W - PAD.left - PAD.right);
  const y = (value: number) =>
    PAD.top + (1 - value / max) * (H - PAD.top - PAD.bottom);

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${x(new Date(p.at).getTime())} ${y(p.severity)}`
    )
    .join(' ');
  const ticks = [0, Math.round(max / 2), max];
  const marks = entry.treatments.filter((tr) => {
    if (!tr.taken_at) return false;
    const at = new Date(tr.taken_at).getTime();
    return at >= start && at <= end;
  });
  const summary = t(
    'symptoms.chart.summary',
    'Severity over the episode, {{count}} readings',
    { count: points.length }
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={summary}
    >
      <title>{summary}</title>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={PAD.left - 6}
            y={y(tick) + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[9px]"
          >
            {tick}
          </text>
        </g>
      ))}
      {marks.map((tr) => {
        const at = new Date(tr.taken_at as string).getTime();
        return (
          <g key={tr.id}>
            <line
              x1={x(at)}
              x2={x(at)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-green-600"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <text
              x={x(at) + 3}
              y={PAD.top + 8}
              className="fill-green-700 text-[9px] dark:fill-green-400"
            >
              {tr.name_snapshot}
            </text>
          </g>
        );
      })}
      <path
        d={line}
        className="fill-none stroke-primary"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p) => (
        <circle
          key={p.at}
          cx={x(new Date(p.at).getTime())}
          cy={y(p.severity)}
          r={3.5}
          className="fill-primary"
        />
      ))}
      <text x={PAD.left} y={H - 6} className="fill-muted-foreground text-[9px]">
        {formatTime(startIso)}
      </text>
      <text
        x={W - PAD.right}
        y={H - 6}
        textAnchor="end"
        className="fill-muted-foreground text-[9px]"
      >
        {formatTime(new Date(end).toISOString())}
      </text>
    </svg>
  );
}
