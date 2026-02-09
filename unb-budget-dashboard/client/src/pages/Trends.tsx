import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { useState, useMemo } from "react";
import { TrendingUp, Filter, X } from "lucide-react";

export default function Trends() {
  const { data: monthlyConsumption, isLoading: monthlyLoading } = trpc.budget.getMonthlyConsumption.useQuery();
  const { data: ugrAnalysis, isLoading: ugrLoading } = trpc.budget.getUGRAnalysis.useQuery();
  const { data: kpis } = trpc.budget.getKPIs.useQuery();

  const [selectedUGRs, setSelectedUGRs] = useState<string[]>([]);
  const [filterInput, setFilterInput] = useState("");
  const [chartType, setChartType] = useState<'line' | 'area' | 'composed'>('line');

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Dados com acumulado
  const dataWithCumulative = useMemo(() => {
    if (!monthlyConsumption) return [];
    let cumulative = 0;
    return (monthlyConsumption || []).map((item: any) => {
      cumulative += item.Consumo_Mensal || 0;
      const percentExecution = kpis?.total_anual_estimado
        ? (cumulative / kpis.total_anual_estimado) * 100
        : 0;
      return {
        ...item,
        Consumo_Acumulado: cumulative,
        Percentual_Execucao: percentExecution,
      };
    });
  }, [monthlyConsumption, kpis]);

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

  const addUGR = (ugr: string) => {
    if (!selectedUGRs.includes(ugr)) {
      setSelectedUGRs([...selectedUGRs, ugr]);
    }
    setFilterInput("");
  };

  const removeUGR = (ugr: string) => {
    setSelectedUGRs(selectedUGRs.filter((u) => u !== ugr));
  };

  // Calcular tendências
  const trends = useMemo(() => {
    if (dataWithCumulative.length < 2) return { trend: 'estável', growth: 0 };
    
    const firstHalf = dataWithCumulative.slice(0, Math.floor(dataWithCumulative.length / 2));
    const secondHalf = dataWithCumulative.slice(Math.floor(dataWithCumulative.length / 2));
    
    const avgFirst = firstHalf.reduce((sum: number, item: any) => sum + item.Consumo_Mensal, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum: number, item: any) => sum + item.Consumo_Mensal, 0) / secondHalf.length;
    
    const growth = ((avgSecond - avgFirst) / avgFirst) * 100;
    const trend = growth > 5 ? 'crescente' : growth < -5 ? 'decrescente' : 'estável';
    
    return { trend, growth };
  }, [dataWithCumulative]);

  const renderChart = () => {
    if (monthlyLoading) {
      return <div className="h-96 flex items-center justify-center text-slate-500">Carregando...</div>;
    }

    const avgConsumption = dataWithCumulative.length > 0
      ? dataWithCumulative.reduce((sum: number, item: any) => sum + item.Consumo_Mensal, 0) / dataWithCumulative.length
      : 0;

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={dataWithCumulative} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="Mês" />
            <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
            <Tooltip formatter={(value) => {
              if (typeof value === 'number' && value > 100) {
                return formatCurrency(value);
              }
              return `${(value as number).toFixed(2)}%`;
            }} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <ReferenceLine yAxisId="left" y={avgConsumption} stroke="#ef4444" strokeDasharray="5 5" label="Média" />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="Consumo_Mensal"
              stroke="#0ea5e9"
              strokeWidth={3}
              dot={{ fill: '#0ea5e9', r: 5 }}
              name="Consumo Mensal"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="Percentual_Execucao"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 4 }}
              name="% Execução"
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={dataWithCumulative} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <defs>
              <linearGradient id="colorConsumption" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="colorAccum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="Mês" />
            <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
            <Tooltip formatter={(value) => {
              if (typeof value === 'number' && value > 100) {
                return formatCurrency(value);
              }
              return `${(value as number).toFixed(2)}%`;
            }} />
            <Legend wrapperStyle={{ paddingTop: '20px' }} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="Consumo_Mensal"
              stroke="#0ea5e9"
              fillOpacity={1}
              fill="url(#colorConsumption)"
              name="Consumo Mensal"
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="Percentual_Execucao"
              stroke="#10b981"
              fillOpacity={1}
              fill="url(#colorAccum)"
              name="% Execução"
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={dataWithCumulative} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="Mês" />
          <YAxis yAxisId="left" label={{ value: 'Valor (R$)', angle: -90, position: 'insideLeft' }} />
          <YAxis yAxisId="right" orientation="right" label={{ value: 'Taxa (%)', angle: 90, position: 'insideRight' }} />
          <Tooltip formatter={(value) => {
            if (typeof value === 'number' && value > 100) {
              return formatCurrency(value);
            }
            return `${(value as number).toFixed(2)}%`;
          }} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          <ReferenceLine yAxisId="left" y={avgConsumption} stroke="#ef4444" strokeDasharray="5 5" label="Média" />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="Consumo_Mensal"
            stroke="#0ea5e9"
            fillOpacity={0.3}
            fill="#0ea5e9"
            name="Consumo Mensal"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="Percentual_Execucao"
            stroke="#10b981"
            strokeWidth={3}
            dot={{ fill: '#10b981', r: 5 }}
            name="% Execução"
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
          <h1 className="text-3xl font-bold text-slate-900">Tendências</h1>
          <p className="text-slate-600 mt-1">Análise de tendências e evolução do orçamento ao longo do tempo</p>
        </div>

        {/* Trend Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100 border-l-4 border-l-blue-600">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Tendência Geral
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900 capitalize">{trends.trend}</div>
              <p className="text-xs text-slate-600 mt-2">
                {trends.growth > 0 ? '+' : ''}{trends.growth.toFixed(2)}% de variação
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-green-100 border-l-4 border-l-green-600">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Consumo Médio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {formatCurrency(
                  dataWithCumulative.length > 0
                    ? dataWithCumulative.reduce((sum: number, item: any) => sum + item.Consumo_Mensal, 0) / dataWithCumulative.length
                    : 0
                )}
              </div>
              <p className="text-xs text-slate-600 mt-2">Por mês</p>
            </CardContent>
          </Card>
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
          {(['line', 'area', 'composed'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${
                chartType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-900 hover:bg-slate-300'
              }`}
            >
              {type === 'line' ? 'Linha' : type === 'area' ? 'Área' : 'Combinado'}
            </button>
          ))}
        </div>

        {/* Main Chart */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Evolução do Orçamento 2025</CardTitle>
          </CardHeader>
          <CardContent>
            {renderChart()}
          </CardContent>
        </Card>

        {/* Insights */}
        <Card className="border-0 shadow-lg bg-blue-50 border-l-4 border-l-blue-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Insights de Tendência
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-slate-700">
              <p>
                <strong>Padrão Detectado:</strong> O orçamento apresenta tendência <strong>{trends.trend}</strong> com variação de <strong>{trends.growth.toFixed(2)}%</strong> entre períodos.
              </p>
              <p>
                <strong>Consumo Médio Mensal:</strong> {formatCurrency(
                  dataWithCumulative.length > 0
                    ? dataWithCumulative.reduce((sum: number, item: any) => sum + item.Consumo_Mensal, 0) / dataWithCumulative.length
                    : 0
                )}
              </p>
              <p>
                <strong>Recomendação:</strong> {trends.trend === 'crescente' 
                  ? 'O consumo está aumentando. Monitore para evitar excesso orçamentário.'
                  : trends.trend === 'decrescente'
                  ? 'O consumo está diminuindo. Verifique se há restrições ou atrasos.'
                  : 'O consumo está estável. Mantenha o acompanhamento regular.'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

