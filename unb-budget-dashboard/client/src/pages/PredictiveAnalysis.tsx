import { useMemo, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
  ReferenceLine
} from 'recharts';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  BrainCircuit,
  Calendar,
  Zap,
  Target
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { getMonthKeysFromRows, getReferenceYearFromRows } from '@/lib/budget';

// --- Interfaces ---

interface UGRAnalysis {
  ugr: string;
  accumulated: number;    // "Real ou Comprometido" até agora
  projected: number;      // Previsão para o fim do exercício
  total_annual: number;   // Soma de Real + Previsto
  burn_rate: number;      // Média mensal de gasto
  trend: 'up' | 'down' | 'stable';
  status: 'critical' | 'warning' | 'good';
  message: string;        // "Explicação para o gestor"
}

// --- Utils ---

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatMonthLabel = (date: Date): string => {
  const month = date.toLocaleDateString('pt-BR', { month: 'short' });
  return month.charAt(0).toUpperCase() + month.slice(1);
};

// --- Component ---

export default function PredictiveAnalysis() {
  // Data Fetching
  const { data: monthlyData } = trpc.budget.getMonthlyConsumption.useQuery();
  const { data: ugrData } = trpc.budget.getUGRAnalysis.useQuery();
  const { data: allData } = trpc.budget.getAllData.useQuery();

  const [selectedUGR, setSelectedUGR] = useState<string | null>(null);

  const monthKeys = useMemo(() => getMonthKeysFromRows(allData || []), [allData]);
  const referenceYear = useMemo(() => getReferenceYearFromRows(allData || []), [allData]);

  // 1. Prepare Main Chart Data (Real vs Predicted)
  const chartData = useMemo(() => {
    if (!monthlyData || monthlyData.length === 0) return [];

    const currentYear = new Date().getFullYear();

    // Sort and Parse
    const sortedHistory = [...monthlyData]
      .sort((a: any, b: any) => a.Mes.localeCompare(b.Mes))
      .map((m: any) => ({
        monthStr: m.Mes, // "YYYY-MM"
        monthDate: new Date(m.Mes),
        value: Number(m.Consumo_Mensal || 0)
      }));

    const lastRecIndex = sortedHistory.length - 1;
    const lastRecMonthIndex = sortedHistory[lastRecIndex]
      ? sortedHistory[lastRecIndex].monthDate.getMonth()
      : -1;

    // Linear Regression parameters (Trend)
    const n = sortedHistory.length;
    let slope = 0, intercept = 0;

    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = sortedHistory.reduce((acc, curr) => acc + curr.value, 0) / n;

      let num = 0, den = 0;
      sortedHistory.forEach((point, i) => {
        num += (i - xMean) * (point.value - yMean);
        den += (i - xMean) ** 2;
      });

      slope = den !== 0 ? num / den : 0;
      intercept = yMean - slope * xMean;
    } else if (n === 1) {
      intercept = sortedHistory[0].value;
    }

    // Generate Full Year Series (Jan to Dec)
    const fullSeries = [];

    // We want the projection line to span the WHOLE year to show the trend fit
    // But logically "Projected" usually means future. 
    // For this visual (Bar + Line), let's show Trend for full year (dashed)
    // And Bars for Real.

    for (let i = 0; i < 12; i++) {
      const date = new Date(currentYear, i, 1);
      const monthLabel = formatMonthLabel(date);

      const isHistory = i <= lastRecMonthIndex;

      let realValue = null;
      const histPoint = sortedHistory.find(h => h.monthDate.getMonth() === i);
      if (histPoint) realValue = histPoint.value;
      else if (isHistory) realValue = 0;

      // Regression Calculation
      const startMonthIndex = sortedHistory[0] ? sortedHistory[0].monthDate.getMonth() : 0;
      const regressionX = i - startMonthIndex;
      let predictedValue = Math.max(0, intercept + slope * regressionX);

      // Area logic (Confidence Interval - Dummy heuristic for now: +/- 10% widening over time)
      // The further out, the wider the cone
      const futureMonths = Math.max(0, i - lastRecMonthIndex);
      const uncertainty = predictedValue * (0.05 + (futureMonths * 0.02));

      fullSeries.push({
        month: monthLabel,
        real: realValue,         // Bar
        trend: predictedValue,   // Line (Full Year)
        upper: predictedValue + uncertainty,
        lower: Math.max(0, predictedValue - uncertainty)
      });
    }

    return fullSeries;

  }, [monthlyData]);

  // Statistics Calculation
  const stats = useMemo(() => {
    if (!monthlyData) return { burnRate: 0, projectedTotal: 0, currentTotal: 0 };

    const currentTotal = monthlyData.reduce((acc: number, curr: any) => acc + Number(curr.Consumo_Mensal || 0), 0);
    const burnRate = monthlyData.length > 0 ? currentTotal / monthlyData.length : 0;

    // Annual projection based on burn rate
    // remaining months = 12 - current months
    const remaining = Math.max(0, 12 - monthlyData.length);
    const projectedTotal = currentTotal + (burnRate * remaining);

    return { burnRate, projectedTotal, currentTotal };
  }, [monthlyData]);

  // 2. UGR Analysis Logic
  const ugrAnalysis: UGRAnalysis[] = useMemo(() => {
    if (!allData || !ugrData) return [];

    const results: UGRAnalysis[] = [];
    const byUGR: Record<string, any[]> = {};

    allData.forEach((row: any) => {
      const u = row.UGR || 'Outros';
      if (!byUGR[u]) byUGR[u] = [];
      byUGR[u].push(row);
    });

    for (const [ugr, rows] of Object.entries(byUGR)) {
      let acc = 0;
      rows.forEach(row => {
        monthKeys.forEach((key) => {
          acc += Number(row[key] || 0);
        });
      });

      const avg = monthKeys.length > 0 ? acc / monthKeys.length : 0;
      const remainingMonths = Math.max(0, 12 - monthKeys.length);
      const projectedFuture = avg * remainingMonths;
      const totalAnnual = acc + projectedFuture;
      const trend = avg > 0 ? 'up' : 'stable';

      const budget = rows.reduce((s, r) => s + Number(r.Total_Anual_Estimado || 0), 0);
      let status: UGRAnalysis['status'] = 'good';
      let message = "Dentro da meta.";

      if (budget > 0) {
        const percent = (totalAnnual / budget);
        if (percent > 1.0) {
          status = 'critical';
          message = "Risco Alto: Projeção estoura o orçamento.";
        } else if (percent < 0.8) {
          status = 'warning';
          message = "Abaixo da meta (Sobra de recursos).";
        }
      } else if (totalAnnual > 0) {
        status = 'warning';
        message = "Sem orçamento cadastrado.";
      }

      results.push({
        ugr,
        accumulated: acc,
        projected: projectedFuture,
        total_annual: totalAnnual,
        burn_rate: avg,
        trend: trend as any,
        status,
        message
      });
    }

    return results.sort((a, b) => b.accumulated - a.accumulated);

  }, [allData, ugrData, monthKeys]);


  const displayedUGRs = selectedUGR
    ? ugrAnalysis.filter(u => u.ugr === selectedUGR)
    : ugrAnalysis;

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'critical':
        return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-bold bg-red-100 text-red-800">Crítico</span>;
      case 'warning':
        return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-800">Atenção</span>;
      case 'good':
        return <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800">Regular</span>;
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 pb-10">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <BrainCircuit className="w-8 h-8 text-indigo-600" />
            Inteligência Preditiva (v2.0)
          </h1>
          <p className="text-slate-500 mt-2 text-lg">
            Análise de velocidade de gasto e projeção de fechamento anual.
          </p>
        </div>

        {/* KPIs Cards (New Stats) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-l-4 border-blue-500 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-500">Média (Burn Rate)</span>
                <Zap className="w-5 h-5 text-blue-500 opacity-70" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(stats.burnRate)}</div>
              <div className="text-xs text-slate-500 mt-1">Velocidade média de gasto/mês</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-purple-500 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-500">Projeção de Fechamento</span>
                <Target className="w-5 h-5 text-purple-500 opacity-70" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(stats.projectedTotal)}</div>
              <div className="text-xs text-slate-500 mt-1">Se mantiver o ritmo atual</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-slate-500 shadow-sm bg-slate-50">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-slate-500">Realizado (YTD)</span>
                <Calendar className="w-5 h-5 text-slate-500 opacity-70" />
              </div>
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(stats.currentTotal)}</div>
              <div className="text-xs text-slate-500 mt-1">Total executado até o momento</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Chart: Bar + Line Combo */}
        <Card className="shadow-lg border-indigo-100">
          <CardHeader>
            <CardTitle className="text-indigo-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Tendência de Execução
            </CardTitle>
            <CardDescription>
              Barras Azuis = O que realmente aconteceu. Linha Roxa = Tendência matemática para o ano todo.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e7ff" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis
                  tickFormatter={(val) => `R$${(val / 1000).toFixed(0)}k`}
                  tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'lower' || name === 'upper') return [];
                    return [formatCurrency(value), name];
                  }}
                  labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                />
                <Legend verticalAlign="top" iconType="circle" wrapperStyle={{ paddingBottom: '20px' }} />

                {/* Confidence Interval (Area) */}
                {/* <Area type="monotone" dataKey="upper" stroke="none" fill="#f3e8ff" fillOpacity={0.5} name="Margem de Erro" /> */}

                {/* Real Data (Bars) - High Visibility */}
                <Bar
                  dataKey="real"
                  name="Execução Real"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                  barSize={40}
                  fillOpacity={0.9}
                />

                {/* Trend Line - Overlay */}
                <Line
                  type="monotone"
                  dataKey="trend"
                  name="Tendência Linear"
                  stroke="#9333ea"
                  strokeWidth={3}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={{ r: 6 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Detailed Table */}
        <Card className="border-0 shadow-md ring-1 ring-slate-100">
          <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg text-slate-800">Detalhamento por Unidade</CardTitle>
                <CardDescription>Acompanhamento individualizado de performance.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedUGR(null)} disabled={!selectedUGR}>
                Ver Todas
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">UGR</th>
                    <th className="px-6 py-3 text-right">Média Mensal</th>
                    <th className="px-6 py-3 text-right">Acumulado</th>
                    <th className="px-6 py-3 text-right font-bold text-indigo-600">Projeção Final</th>
                    <th className="px-6 py-3 text-center">Status</th>
                    <th className="px-6 py-3">Diagnóstico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {displayedUGRs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                        Nenhum dado disponível.
                      </td>
                    </tr>
                  ) : (
                    displayedUGRs.map((u, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-800">{u.ugr}</td>
                        <td className="px-6 py-4 text-right">{formatCurrency(u.burn_rate)}</td>
                        <td className="px-6 py-4 text-right text-slate-600">{formatCurrency(u.accumulated)}</td>
                        <td className="px-6 py-4 text-right font-bold text-indigo-700 bg-indigo-50/30">
                          {formatCurrency(u.total_annual)}
                        </td>
                        <td className="px-6 py-4 text-center">{renderStatusBadge(u.status)}</td>
                        <td className="px-6 py-4 text-slate-600 max-w-xs truncate" title={u.message}>
                          {u.message}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
