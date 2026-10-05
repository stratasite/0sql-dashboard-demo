'use client';

/**
 * One result set, drawn.
 *
 * The chart kind arrives with the data (the model asks for one, the server
 * sanity-checks it against the shape of the result). Everything here is
 * token-driven so both themes come from the same component, and every series
 * is labelled: a legend whenever there are two or more, a table view always a
 * click away, so identity never rests on colour alone.
 */
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ChartKind, ResultSet } from '@/types';
import { asNumber, formatCategory, formatValue, series as splitSeries } from '@/lib/chart';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

const axis = {
  stroke: 'var(--border)',
  tick: { fill: 'var(--muted-foreground)', fontSize: 11 },
};

export function ChartView({
  chart,
  result,
  height = 240,
}: {
  chart: ChartKind;
  result: ResultSet;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const { categoryKey, valueKeys } = useMemo(() => splitSeries(result), [result]);

  if (result.rows.length === 0) {
    return <Empty>No rows. The filters, or the caller's permissions, excluded everything.</Empty>;
  }

  if (chart === 'number') {
    return <Hero result={result} valueKeys={valueKeys} />;
  }

  if (chart === 'table' || asTable || !categoryKey || valueKeys.length === 0) {
    return (
      <div>
        <Table result={result} />
        {chart !== 'table' && (
          <Toggle onClick={() => setAsTable(false)} label="Show the chart" />
        )}
      </div>
    );
  }

  const data = result.rows.map((row) => {
    const point: Record<string, unknown> = { __label: formatCategory(row[categoryKey]) };
    for (const key of valueKeys) point[key] = asNumber(row[key]);
    return point;
  });

  const common = (
    <>
      <CartesianGrid stroke="var(--grid)" strokeDasharray="2 4" vertical={false} />
      <XAxis
        dataKey="__label"
        {...axis}
        interval="preserveStartEnd"
        minTickGap={16}
        tickLine={false}
      />
      <YAxis {...axis} tickFormatter={(v) => formatValue(v)} tickLine={false} width={48} />
      <Tooltip
        contentStyle={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--foreground)',
        }}
        labelStyle={{ color: 'var(--muted-foreground)' }}
        formatter={(value: unknown, name) => [formatValue(value), name as string]}
        cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
      />
      {valueKeys.length > 1 && (
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="plainline"
          iconSize={10}
          wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
        />
      )}
    </>
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        {chart === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {common}
            {valueKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
              />
            ))}
          </LineChart>
        ) : chart === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {common}
            {valueKeys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                fill={SERIES[i % SERIES.length]}
                fillOpacity={0.12}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barGap={2}>
            {common}
            {valueKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]}>
                {valueKeys.length === 1 &&
                  data.map((_, index) => (
                    <Cell key={index} stroke="var(--surface)" strokeWidth={2} />
                  ))}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      <Toggle onClick={() => setAsTable(true)} label="Show the numbers" />
    </div>
  );
}

function Hero({ result, valueKeys }: { result: ResultSet; valueKeys: string[] }) {
  const row = result.rows[0];
  return (
    <div className="flex flex-wrap gap-8 py-4">
      {valueKeys.map((key) => (
        <div key={key}>
          <div className="font-mono text-3xl tabular-nums">{formatValue(row[key])}</div>
          <div className="mt-1 text-xs text-muted">{key}</div>
        </div>
      ))}
    </div>
  );
}

function Table({ result }: { result: ResultSet }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            {result.columns.map((c) => (
              <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {result.rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {result.columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5">
                  {asNumber(row[c]) !== null ? formatValue(row[c]) : formatCategory(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="px-3 py-2 text-xs text-muted">
          First {result.rows.length} rows; the statement returned more.
        </p>
      )}
    </div>
  );
}

function Toggle({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
    >
      {label}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-muted">{children}</p>;
}
