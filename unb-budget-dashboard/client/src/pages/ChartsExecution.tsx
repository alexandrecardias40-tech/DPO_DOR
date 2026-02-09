import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";
import { TrendingUp, AlertCircle } from "lucide-react";

export default function ChartsExecution() {
  const { data: ugrAnalysis, isLoading: ugrLoading } = trpc.budget.getUGRAnalysis.useQuery();
  const [sortBy, setSortBy] = useState<'execution' | 'budget'>('execution');

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  const sortedData = [...(ugrAnalysis || [])].sort((a: any, b: any) => {
    if (sortBy === 'execution') {
      return b.Percentual_Execucao - a.Percentual_Execucao;
    }
    return b.Total_Anual_Estimado - a.Total_Anual_Estimado;
  });

  const avgExecution = ugrAnalysis
    ? (ugrAnalysis.reduce((sum: number, u: any) => sum + u.Percentual_Execucao, 0) / ugrAnalysis.length)
    : 0;

  const highExecution = ugrAnalysis ? ugrAnalysis.filter((u: any) => u.Percentual_Execucao > 75).length : 0;
  const lowExecution = ugrAnalysis ? ugrAnalysis.filter((u: any) => u.Percentual_Execucao < 25).length : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Taxa de Execução por UGR</h1>
          <p className="text-slate-600 mt-1">Análise detalhada da execução orçamentária de cada unidade gestora</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100 border-l-4 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Execução Média</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{formatPercent(avgExecution)}</div>
              <p className="text-xs text-slate-600 mt-2">Entre todas as UGRs</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-green-100 border-l-4 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Alta Execução</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{highExecution}</div>
              <p className="text-xs text-slate-600 mt-2">Acima de 75%</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-orange-100 border-l-4 border-l-orange-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Baixa Execução</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{lowExecution}</div>
              <p className="text-xs text-slate-600 mt-2">Abaixo de 25%</p>
            </CardContent>
          </Card>
        </div>

        {/* Sort Controls */}
        <div className="flex gap-2">
          <button
            onClick={() => setSortBy('execution')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              sortBy === 'execution'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
            }`}
          >
            Ordenar por Execução
          </button>
          <button
            onClick={() => setSortBy('budget')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              sortBy === 'budget'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
            }`}
          >
            Ordenar por Orçamento
          </button>
        </div>

        {/* Main Chart - Taxa de Execução */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Taxa de Execução por UGR</CardTitle>
          </CardHeader>
          <CardContent>
            {ugrLoading ? (
              <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={sortedData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="UGR" angle={-45} textAnchor="end" height={100} />
                  <YAxis label={{ value: 'Taxa (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip formatter={(value) => formatPercent(value as number)} />
                  <ReferenceLine y={avgExecution} stroke="#ef4444" strokeDasharray="5 5" label="Média" />
                  <Bar dataKey="Percentual_Execucao" radius={[8, 8, 0, 0]}>
                    {sortedData.map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.Percentual_Execucao > 75
                            ? '#10b981'
                            : entry.Percentual_Execucao > 50
                            ? '#3b82f6'
                            : entry.Percentual_Execucao > 25
                            ? '#f59e0b'
                            : '#ef4444'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Orçamento vs Execução Comparativo */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Orçamento vs Execução (Top 15)</CardTitle>
          </CardHeader>
          <CardContent>
            {ugrLoading ? (
              <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={sortedData.slice(0, 15)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="UGR" angle={-45} textAnchor="end" height={100} />
                  <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
                  <Tooltip formatter={(value) => {
                    if (typeof value === 'number' && value > 100) {
                      return formatCurrency(value);
                    }
                    return formatPercent(value as number);
                  }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="Total_Anual_Estimado" fill="#0ea5e9" radius={[8, 8, 0, 0]} name="Orçamento" />
                  <Bar yAxisId="left" dataKey="Total_Empenho_RAP" fill="#10b981" radius={[8, 8, 0, 0]} name="Executado" />
                  <Line yAxisId="right" type="monotone" dataKey="Percentual_Execucao" stroke="#f59e0b" strokeWidth={3} name="Taxa %" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Detailed Table */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Detalhes Completos</CardTitle>
          </CardHeader>
          <CardContent>
            {ugrLoading ? (
              <div className="text-center py-8 text-slate-500">Carregando...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-900">UGR</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Orçamento</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Executado</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Saldo</th>
                      <th className="px-4 py-3 text-right font-semibold text-slate-900">Taxa %</th>
                      <th className="px-4 py-3 text-center font-semibold text-slate-900">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedData.map((ugr: any, idx: number) => {
                      const saldo = ugr.Total_Anual_Estimado - ugr.Total_Empenho_RAP;
                      let status = '';
                      let statusColor = '';
                      if (ugr.Percentual_Execucao > 75) {
                        status = 'Alta Execução';
                        statusColor = 'bg-green-100 text-green-800';
                      } else if (ugr.Percentual_Execucao > 50) {
                        status = 'Execução Normal';
                        statusColor = 'bg-blue-100 text-blue-800';
                      } else if (ugr.Percentual_Execucao > 25) {
                        status = 'Execução Baixa';
                        statusColor = 'bg-orange-100 text-orange-800';
                      } else {
                        status = 'Crítico';
                        statusColor = 'bg-red-100 text-red-800';
                      }
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-900">{ugr.UGR}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Anual_Estimado)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Empenho_RAP)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(saldo)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-bold text-blue-600">{formatPercent(ugr.Percentual_Execucao)}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Insights */}
        <Card className="border-0 shadow-lg bg-blue-50 border-l-4 border-l-blue-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                <strong>Execução Média:</strong> {formatPercent(avgExecution)} - {avgExecution > 50 ? 'Acima da meta de 50%' : 'Abaixo da meta de 50%'}
              </p>
              <p>
                <strong>UGRs com Alta Execução:</strong> {highExecution} unidades com mais de 75% de execução
              </p>
              <p>
                <strong>UGRs em Risco:</strong> {lowExecution} unidades com menos de 25% de execução
              </p>
              {lowExecution > 0 && (
                <div className="flex gap-2 mt-3 p-3 bg-orange-100 rounded border border-orange-300">
                  <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <p className="text-orange-900">
                    Recomendação: Acompanhar as UGRs com baixa execução para evitar desperdício de orçamento no final do ano.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

