'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import {
  AreaChart,
  LinearXAxis,
  LinearXAxisTickSeries,
  LinearXAxisTickLabel,
  LinearYAxis,
  LinearYAxisTickSeries,
  AreaSeries,
  Area,
  Gradient,
  GradientStop,
  GridlineSeries,
  Gridline,
} from 'reaviz';
// reaviz data shape types (not re-exported from main package)
interface ChartShallowDataShape { key: Date | string | number; data: number; }
interface ChartNestedDataShape  { key: string; data: ChartShallowDataShape[]; }
import {
  getCompareUsageByDay,
  getCompareUsageTotals,
} from '../../utils/compareAnalytics';

interface TimePeriodOption {
  value: string;
  label: string;
  days: number;
}

const TIME_PERIOD_OPTIONS: TimePeriodOption[] = [
  { value: 'last-7-days',  label: 'Last 7 Days',  days: 7  },
  { value: 'last-14-days', label: 'Last 14 Days', days: 14 },
  { value: 'last-30-days', label: 'Last 30 Days', days: 30 },
];

const UpArrowIcon: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 21" fill="none">
    <path d="M5.5 9.1L10 4.7M10 4.7L14.5 9.1M10 4.7V16.3" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const DownArrowIcon: React.FC<{ strokeColor: string }> = ({ strokeColor }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 21" fill="none">
    <path d="M14.5 11.9L10 16.3M10 16.3L5.5 11.9M10 16.3V4.7" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const TrendUpIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="26" height="26" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.35" />
    <path d="M9.5 12.6L14 8.2M14 8.2L18.5 12.6M14 8.2V19.8" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const TrendDownIcon: React.FC<{ baseColor: string; strokeColor: string; className?: string }> = ({ baseColor, strokeColor, className }) => (
  <svg className={className} width="26" height="26" viewBox="0 0 28 28" fill="none">
    <rect width="28" height="28" rx="14" fill={baseColor} fillOpacity="0.35" />
    <path d="M18.5 15.4L14 19.8M14 19.8L9.5 15.4M14 19.8V8.2" stroke={strokeColor} strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const ArrowsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4M4 17l4-4" />
  </svg>
);

const ChunksIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16M4 10h16M4 14h8M4 18h8" />
  </svg>
);

const UsersIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

function buildChartData(days: number): ChartNestedDataShape[] {
  const { dates, directCounts, chunkCounts } = getCompareUsageByDay(days);
  return [
    {
      key: 'Direct',
      data: dates.map((d, i) => ({ key: d, data: directCounts[i] } as ChartShallowDataShape)),
    },
    {
      key: 'Chunk-based',
      data: dates.map((d, i) => ({ key: d, data: chunkCounts[i] } as ChartShallowDataShape)),
    },
  ];
}

const CompareUsageChart: React.FC = () => {
  const [selectedPeriod, setSelectedPeriod] = useState(TIME_PERIOD_OPTIONS[0].value);
  const selectedOption = useMemo(
    () => TIME_PERIOD_OPTIONS.find((o) => o.value === selectedPeriod) ?? TIME_PERIOD_OPTIONS[0],
    [selectedPeriod]
  );
  const chartData = useMemo(() => buildChartData(selectedOption.days), [selectedOption.days]);
  const totals = getCompareUsageTotals();

  const directPct = totals.total > 0 ? Math.round((totals.direct / totals.total) * 100) : 0;
  const chunkPct  = totals.total > 0 ? Math.round((totals.chunk  / totals.total) * 100) : 0;

  const directTrend = directPct >= chunkPct ? 'up' : 'down';
  const chunkTrend  = chunkPct  >= directPct ? 'up' : 'down';

  return (
    <>
      <style>{`
        .cuc-root {
          --reaviz-tick-fill: #9A9AAF;
          --reaviz-gridline-stroke: #7E7E8F75;
        }
        .dark .cuc-root {
          --reaviz-tick-fill: #A0AEC0;
          --reaviz-gridline-stroke: rgba(74,85,104,0.5);
        }
      `}</style>
      <div className="cuc-root flex flex-col bg-white dark:bg-[#0c1829] rounded-2xl border border-gray-200 dark:border-[#17253f] shadow-sm w-full overflow-hidden transition-colors duration-300">

        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-5 pb-4">
          <div>
            <h3 className="text-[15px] font-bold text-gray-900 dark:text-white">
              Compare Analytics
            </h3>
            <p className="text-[11px] mt-0.5 text-gray-500 dark:text-gray-400">
              Workflow usage · {totals.total} total sessions
            </p>
          </div>
          <select
            value={selectedPeriod}
            onChange={e => setSelectedPeriod(e.target.value)}
            className="bg-gray-100 dark:bg-[#17253f] text-gray-700 dark:text-gray-200 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#17253f] focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
            aria-label="Select time period"
          >
            {TIME_PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Legend */}
        <div className="flex gap-5 px-5 mb-3">
          {[
            { name: 'Direct',     color: '#1a6bff' },
            { name: 'Chunk-based', color: '#7c3aed' },
          ].map(item => (
            <div key={item.name} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{item.name}</span>
            </div>
          ))}
        </div>

        {/* Area Chart */}
        <div className="px-2" style={{ height: 200 }}>
          <AreaChart
            height={200}
            data={chartData}
            xAxis={
              <LinearXAxis
                type="time"
                tickSeries={
                  <LinearXAxisTickSeries
                    label={
                      <LinearXAxisTickLabel
                        format={v => new Date(v).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                        fill="var(--reaviz-tick-fill)"
                      />
                    }
                    tickSize={10}
                  />
                }
              />
            }
            yAxis={
              <LinearYAxis
                axisLine={null}
                tickSeries={<LinearYAxisTickSeries line={null} label={null} tickSize={10} />}
              />
            }
            series={
              <AreaSeries
                type="grouped"
                interpolation="smooth"
                area={
                  <Area
                    gradient={
                      <Gradient
                        stops={[
                          <GradientStop key={1} stopOpacity={0} />,
                          <GradientStop key={2} offset="100%" stopOpacity={0.35} />,
                        ]}
                      />
                    }
                  />
                }
                colorScheme={['#1a6bff', '#7c3aed']}
              />
            }
            gridlines={<GridlineSeries line={<Gridline strokeColor="var(--reaviz-gridline-stroke)" />} />}
          />
        </div>

        {/* Summary stats */}
        <div className="flex gap-4 px-5 pt-4 pb-4">
          {/* Direct */}
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] text-gray-600 dark:text-gray-400">Direct Comparisons</span>
            <div className="flex items-center gap-2">
              <CountUp
                className="font-mono text-[26px] font-bold text-gray-900 dark:text-white leading-none"
                start={0}
                end={totals.direct}
                duration={2}
              />
              <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                directTrend === 'up'
                  ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-slate-500/15 text-slate-400'
              }`}>
                {directTrend === 'up'
                  ? <UpArrowIcon strokeColor="#60a5fa" />
                  : <DownArrowIcon strokeColor="#94a3b8" />}
                {directPct}%
              </div>
            </div>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {totals.directUnique} unique user{totals.directUnique !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Divider */}
          <div className="w-px self-stretch bg-gray-200 dark:bg-[#17253f]" />

          {/* Chunk */}
          <div className="flex-1 flex flex-col gap-1">
            <span className="text-[11px] text-gray-600 dark:text-gray-400">Chunk-based Comparisons</span>
            <div className="flex items-center gap-2">
              <CountUp
                className="font-mono text-[26px] font-bold text-gray-900 dark:text-white leading-none"
                start={0}
                end={totals.chunk}
                duration={2}
              />
              <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                chunkTrend === 'up'
                  ? 'bg-violet-500/15 text-violet-400'
                  : 'bg-slate-500/15 text-slate-400'
              }`}>
                {chunkTrend === 'up'
                  ? <UpArrowIcon strokeColor="#a78bfa" />
                  : <DownArrowIcon strokeColor="#94a3b8" />}
                {chunkPct}%
              </div>
            </div>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {totals.chunkUnique} unique user{totals.chunkUnique !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-5 border-t border-gray-100 dark:border-[#17253f]" />

        {/* Detailed metrics */}
        <div className="flex flex-col px-5 divide-y divide-gray-100 dark:divide-[#17253f]">
          {[
            {
              id: 'direct-detail',
              Icon: ArrowsIcon,
              label: 'Direct Comparison',
              tooltip: 'Workflow 1 — upload & detect all changes instantly',
              value: `${totals.direct} uses`,
              TrendIcon: directTrend === 'up' ? TrendUpIcon : TrendDownIcon,
              trendBase:   directTrend === 'up' ? '#1a6bff' : '#374d6a',
              trendStroke: directTrend === 'up' ? '#60a5fa' : '#94a3b8',
              delay: 0,
            },
            {
              id: 'chunk-detail',
              Icon: ChunksIcon,
              label: 'Chunk-based Comparison',
              tooltip: 'Workflow 2 — review per-section changes',
              value: `${totals.chunk} uses`,
              TrendIcon: chunkTrend === 'up' ? TrendUpIcon : TrendDownIcon,
              trendBase:   chunkTrend === 'up' ? '#7c3aed' : '#374d6a',
              trendStroke: chunkTrend === 'up' ? '#a78bfa' : '#94a3b8',
              delay: 0.05,
            },
            {
              id: 'unique-users',
              Icon: UsersIcon,
              label: 'Unique Users',
              tooltip: 'Total distinct users who ran any comparison',
              value: `${new Set([...Array(totals.directUnique), ...Array(totals.chunkUnique)]).size || Math.max(totals.directUnique, totals.chunkUnique)} users`,
              TrendIcon: totals.total > 0 ? TrendUpIcon : TrendDownIcon,
              trendBase:   '#16a34a',
              trendStroke: '#4ade80',
              delay: 0.1,
            },
          ].map(metric => (
            <motion.div
              key={metric.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: metric.delay }}
              className="flex w-full py-3 items-center gap-2"
            >
              <div className="flex items-center gap-2 w-1/2 text-gray-500 dark:text-gray-400">
                <metric.Icon className="flex-shrink-0 w-[18px] h-[18px]" />
                <span className="text-[11px] truncate" title={metric.tooltip}>
                  {metric.label}
                </span>
              </div>
              <div className="flex gap-2 w-1/2 justify-end items-center">
                <span className="font-mono font-semibold text-[13px] text-gray-900 dark:text-white">
                  {metric.value}
                </span>
                <metric.TrendIcon baseColor={metric.trendBase} strokeColor={metric.trendStroke} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
};

export default CompareUsageChart;
