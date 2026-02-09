import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { useState, useMemo } from "react";

export default function ChartsMonthly() {
  const { data: monthlyConsumption, isLoading: monthlyLoading } = trpc.budget.getMonthlyConsumption.useQuery();
  const { data: kpis } = trpc.budget.getKPIs.useQuery();
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar' | 'composed'>('line');

  const referenceYear = useMemo(() => {
    const first = monthlyConsumption?.[0];
    const month = first?.Mes || first?.["Mês"];
    if (typeof month === "string") {
      const match = month.match(/^(\d{4})/);
      if (match?.[1]) return Number(match[1]);
    }
    return null;
  }, [monthlyConsumption]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Calcular consumo acumulado
  const dataWithCumulative = useMemo(() => {
    if (!monthlyConsumption) return [];
    let cumulative = 0;
    return (monthlyConsumption || []).map((item: any) => {
      cumulative += item.Consumo_Mensal || 0;
      const percentExecution = kpis?.total_anual_estimado
        ? (cumulative / kpis.total_anual_estimado) * 100
        : 0;
      const remainingBudget = (kpis?.total_anual_estimado || 0) - cumulative;
      return {
        ...item,
        Consumo_Acumulado: cumulative,
        Percentual_Execucao: percentExecution,
        Saldo_Restante: remainingBudget,
      };
    });
  }, [monthlyConsumption, kpis]);

  const renderChart = () => {
    if (monthlyLoading) {
      return <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>;
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={dataWithCumulative}>
            <defs>
              <linearGradient id="colorConsumption" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="Mês" />
            <YAxis />
            <Tooltip formatter={(value) => formatCurrency(value as number)} />
            <Legend />
            <Line
              type="monotone"
              dataKey="Consumo_Mensal"
              stroke="#0ea5e9"
              strokeWidth={3}
              dot={{ fill: '#0ea5e9', r: 5 }}
              activeDot={{ r: 7 }}
              name="Consumo Mensal"
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={dataWithCumulative}>
            <defs>
              <linearGradient id="colorArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="Mês" />
            <YAxis />
            <Tooltip formatter={(value) => formatCurrency(value as number)} />
            <Legend />
            <Area
              type="monotone"
              dataKey="Consumo_Mensal"
              stroke="#10b981"
              fillOpacity={1}
              fill="url(#colorArea)"
              name="Consumo Mensal"
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={dataWithCumulative}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="Mês" />
            <YAxis />
            <Tooltip formatter={(value) => formatCurrency(value as number)} />
            <Legend />
            <Bar dataKey="Consumo_Mensal" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Consumo Mensal" />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={dataWithCumulative}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="Mês" />
          <YAxis yAxisId="left" />
          <YAxis yAxisId="right" orientation="right" />
          <Tooltip formatter={(value) => formatCurrency(value as number)} />
          <Legend />
          <Bar yAxisId="left" dataKey="Consumo_Mensal" fill="#0ea5e9" radius={[8, 8, 0, 0]} name="Consumo Mensal" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="Consumo_Acumulado"
            stroke="#8b5cf6"
            strokeWidth={3}
            dot={{ fill: '#8b5cf6', r: 5 }}
            name="Consumo Acumulado"
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Consumo Mensal {referenceYear || ""}
          </h1>
          <p className="text-slate-600 mt-1">Análise detalhada do consumo orçamentário ao longo dos meses</p>
        </div>

        {/* Chart Type Selector */}
        <div className="flex gap-2 flex-wrap">
          {(['line', 'area', 'bar', 'composed'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                chartType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
              }`}
            >
              {type === 'composed' ? 'Combinado' : type === 'line' ? 'Linha' : type === 'area' ? 'Área' : 'Barras'}
            </button>
          ))}
        </div>

        {/* Main Chart */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Consumo Mensal</CardTitle>
          </CardHeader>
          <CardContent>
            {renderChart()}
          </CardContent>
        </Card>

        {/* Cumulative Execution Chart */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Execução Acumulada</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyLoading ? (
              <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={dataWithCumulative}>
                  <defs>
                    <linearGradient id="colorExecution" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="Mês" />
                  <YAxis label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="Consumo_Acumulado"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorExecution)"
                    name="Consumo Acumulado"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Budget vs Execution */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Orçamento vs Execução Acumulada</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyLoading ? (
              <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={dataWithCumulative}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="Mês" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="Saldo_Restante" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Saldo Restante" />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="Percentual_Execucao"
                    stroke="#ef4444"
                    strokeWidth={3}
                    dot={{ fill: '#ef4444', r: 5 }}
                    name="% Execução"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Statistics Table */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Estatísticas Mensais</CardTitle>
          </CardHeader>
          <CardContent>
            {monthlyLoading ? (
              <div className="text-center py-8 text-slate-500">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900">Mês</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Consumo Mensal</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Consumo Acumulado</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">% Execução</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo Restante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dataWithCumulative.map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900">{item.Mês}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.Consumo_Mensal)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.Consumo_Acumulado)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-blue-600">{item.Percentual_Execucao.toFixed(2)}%</span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.Saldo_Restante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
