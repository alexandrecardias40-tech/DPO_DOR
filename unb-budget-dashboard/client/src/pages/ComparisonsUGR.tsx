import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { useState, useMemo } from "react";
import { Filter, X } from "lucide-react";
import UGRNetworkMotionChart from "@/components/UGRNetworkMotionChart";

type UGRAnalysisItem = {
  UGR: string;
  Total_Anual_Estimado: number;
  Total_Empenho_RAP: number;
  Percentual_Execucao: number;
  Contratos_Ativos: number;
  Contratos_Expirados: number;
};

export default function ComparisonsUGR() {
  const { data: ugrAnalysis, isLoading: ugrLoading } = trpc.budget.getUGRAnalysis.useQuery();
  const { data: allData, isLoading: allDataLoading } = trpc.budget.getAllData.useQuery();

  const [selectedUGRs, setSelectedUGRs] = useState<string[]>([]);
  const [filterInput, setFilterInput] = useState("");
  const [chartType, setChartType] = useState<'bar' | 'scatter' | 'composed' | 'network'>('network');

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

  // Dados filtrados
  const filteredData = useMemo<UGRAnalysisItem[]>(() => {
    if (!ugrAnalysis) return [];
    if (selectedUGRs.length === 0) return ugrAnalysis;
    return ugrAnalysis.filter((u: any) => selectedUGRs.includes(u.UGR));
  }, [ugrAnalysis, selectedUGRs]);

  // Adicionar UGR ao filtro
  const addUGR = (ugr: string) => {
    if (!selectedUGRs.includes(ugr)) {
      setSelectedUGRs([...selectedUGRs, ugr]);
    }
    setFilterInput("");
  };

  // Remover UGR do filtro
  const removeUGR = (ugr: string) => {
    setSelectedUGRs(selectedUGRs.filter((u) => u !== ugr));
  };

  // Sugestões de UGR
  const suggestions = useMemo(() => {
    if (!ugrAnalysis || filterInput.length === 0) return [];
    return ugrAnalysis
      .filter((u: any) =>
        u.UGR.toLowerCase().includes(filterInput.toLowerCase()) &&
        !selectedUGRs.includes(u.UGR)
      )
      .slice(0, 5)
      .map((u: any) => u.UGR);
  }, [ugrAnalysis, filterInput, selectedUGRs]);

  const renderChart = () => {
    if (ugrLoading) {
      return <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>;
    }

    if (chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={filteredData} margin={{ top: 20, right: 30, left: 20, bottom: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="UGR"
              angle={-45}
              textAnchor="end"
              height={120}
              interval={0}
              tick={{ fontSize: 12 }}
            />
            <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
            <Tooltip formatter={(value) => {
              if (typeof value === 'number' && value > 100) {
                return formatCurrency(value);
              }
              return formatPercent(value as number);
            }} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Bar yAxisId="left" dataKey="Total_Anual_Estimado" fill="#0ea5e9" radius={[8, 8, 0, 0]} name="Orçamento" />
            <Bar yAxisId="left" dataKey="Total_Empenho_RAP" fill="#10b981" radius={[8, 8, 0, 0]} name="Executado" />
            <Line yAxisId="right" type="monotone" dataKey="Percentual_Execucao" stroke="#f59e0b" strokeWidth={2} name="Taxa %" />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'scatter') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="Total_Anual_Estimado"
              name="Orçamento"
              label={{ value: 'Orçamento (R$)', position: 'insideBottomRight', offset: -5 }}
            />
            <YAxis
              dataKey="Total_Empenho_RAP"
              name="Executado"
              label={{ value: 'Executado (R$)', angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(value: any) => formatCurrency(value)}
              labelFormatter={(value: any) => `UGR: ${value}`}
            />
            <Scatter name="UGRs" data={filteredData} fill="#8b5cf6" />
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'network') {
      return <UGRNetworkMotionChart data={filteredData} />;
    }

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={filteredData} margin={{ top: 20, right: 30, left: 20, bottom: 100 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="UGR"
            angle={-45}
            textAnchor="end"
            height={120}
            interval={0}
            tick={{ fontSize: 12 }}
          />
          <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
          <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
          <Tooltip formatter={(value) => {
            if (typeof value === 'number' && value > 100) {
              return formatCurrency(value);
            }
            return formatPercent(value as number);
          }} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          <Bar yAxisId="left" dataKey="Total_Anual_Estimado" fill="#0ea5e9" radius={[8, 8, 0, 0]} name="Orçamento" />
          <Line yAxisId="right" type="monotone" dataKey="Percentual_Execucao" stroke="#ef4444" strokeWidth={2} name="Taxa %" />
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Análise por UGR</h1>
          <p className="text-slate-600 mt-1">Comparação detalhada entre unidades gestoras</p>
        </div>

        {/* Filtro Global */}
        <Card className="border-0 shadow-lg bg-gradient-to-r from-blue-50 to-blue-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Filter className="w-5 h-5" />
              Filtro de UGRs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input com autocomplete */}
            <div className="relative">
              <input
                type="text"
                placeholder="Digite para filtrar UGRs..."
                value={filterInput}
                onChange={(e) => setFilterInput(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Sugestões */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg z-10">
                  {suggestions.map((ugr: string) => (
                    <button
                      key={ugr}
                      onClick={() => addUGR(ugr)}
                      className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors border-b last:border-b-0"
                    >
                      {ugr}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* UGRs Selecionadas */}
            <div className="flex flex-wrap gap-2">
              {selectedUGRs.map((ugr) => (
                <div
                  key={ugr}
                  className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium"
                >
                  {ugr}
                  <button
                    onClick={() => removeUGR(ugr)}
                    className="hover:bg-blue-700 rounded-full p-0.5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Botão Limpar */}
            {selectedUGRs.length > 0 && (
              <button
                onClick={() => setSelectedUGRs([])}
                className="px-4 py-2 bg-slate-300 text-slate-900 rounded-lg font-medium hover:bg-slate-400 transition-colors"
              >
                Limpar Filtro
              </button>
            )}
          </CardContent>
        </Card>

        {/* Chart Type Selector */}
        <div className="flex gap-2 flex-wrap">
          {(['network', 'bar', 'scatter', 'composed'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${chartType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
                }`}
            >
              {type === 'network'
                ? 'Rede Viva'
                : type === 'bar'
                  ? 'Barras'
                  : type === 'scatter'
                    ? 'Scatter'
                    : 'Combinado'}
            </button>
          ))}
        </div>

        {/* Main Chart */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">
              Comparação {selectedUGRs.length > 0 ? `(${selectedUGRs.length} UGRs)` : '(Todas as UGRs)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {renderChart()}
          </CardContent>
        </Card>

        {/* Tabela Detalhada */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Detalhes</CardTitle>
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
                      <th className="px-4 py-3 text-center font-semibold text-slate-900">Contratos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredData.map((ugr: any, idx: number) => {
                      const saldo = ugr.Total_Anual_Estimado - ugr.Total_Empenho_RAP;
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-900">{ugr.UGR}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Anual_Estimado)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Empenho_RAP)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(saldo)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-bold ${ugr.Percentual_Execucao > 75 ? 'text-green-600' :
                                ugr.Percentual_Execucao > 50 ? 'text-blue-600' :
                                  'text-orange-600'
                              }`}>
                              {formatPercent(ugr.Percentual_Execucao)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block bg-slate-200 text-slate-900 rounded-full px-3 py-1 text-xs font-semibold">
                              {ugr.Contratos_Ativos + ugr.Contratos_Expirados}
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
      </div>
    </DashboardLayout>
  );
}
