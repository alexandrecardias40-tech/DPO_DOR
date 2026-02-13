import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  ComposedChart
} from "recharts";
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Calendar
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatMonthShort, getMonthKeysFromRows, getReferenceYearFromRows } from "@/lib/budget";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
// ContractsMindMap import removed

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

export default function UGRDetails() {
  const [, setLocation] = useLocation();
  const { data: allData } = trpc.budget.getAllData.useQuery();
  const { data: ugrData } = trpc.budget.getUGRAnalysis.useQuery();

  const [selectedUGR, setSelectedUGR] = useState<string | null>(null);
  const monthKeys = useMemo(() => getMonthKeysFromRows(allData || []), [allData]);
  const referenceYear = useMemo(() => getReferenceYearFromRows(allData || []), [allData]);

  // Get UGR from URL or show list
  const ugrFromUrl = new URLSearchParams(window.location.search).get("ugr");
  const currentUGR = selectedUGR || ugrFromUrl;

  // Filter data for selected UGR
  const ugrContracts = currentUGR
    ? (allData || []).filter((item: any) => item.UGR === currentUGR)
    : [];

  const ugrStats = currentUGR
    ? (ugrData || []).find((item: any) => item.UGR === currentUGR)
    : null;

  // --- Intelligence & Calculations ---

  // 1. Financials
  const totalBudget = ugrStats?.Total_Anual_Estimado || 0;
  const totalExecuted = ugrStats?.Total_Empenho_RAP || 0;
  const balance = totalBudget - totalExecuted;

  // Recalculate execution rate dynamically to ensure consistency with displayed values
  // The pre-calculated field might be outdated or use different logic.
  const executionRate = totalBudget > 0 ? (totalExecuted / totalBudget) * 100 : 0;

  // 2. Monthly Data & Burn-up
  const monthlyData = useMemo(() => {
    if (!currentUGR) return [];
    let accumulated = 0;
    return monthKeys.map((monthKey) => {
      const monthlyTotal = ugrContracts.reduce((sum: number, contract: any) => sum + (contract[monthKey] || 0), 0);
      accumulated += monthlyTotal;
      return {
        month: formatMonthShort(monthKey),
        consumption: monthlyTotal,
        accumulated: accumulated,
        budgetLine: totalBudget // Constant for comparison
      };
    });
  }, [currentUGR, monthKeys, ugrContracts, totalBudget]);

  // 5. Scenario Projection (Linear Extrapolation)
  const averageConsumption = monthlyData.length > 0
    ? monthlyData[monthlyData.length - 1].accumulated / monthlyData.length
    : 0;
  const projectedEndOfYear = averageConsumption * 12;
  const projectedBalance = totalBudget - projectedEndOfYear;

  // 3. Current Month Context & Scenario
  const today = new Date();
  const currentMonthIndex = today.getMonth(); // 0-11
  // Ideally, find the data for the current month.
  // Assuming monthlyData is ordered Jan-Dec.
  // If data is historic (e.g. 2024), we might want to show the specific month from that year
  // or the last available month if we are past the year.
  // For now, let's try to match the current month index to the data array if it exists.
  const currentMonthData = monthlyData[currentMonthIndex];
  // const lastMonthData = currentMonthIndex > 0 ? monthlyData[currentMonthIndex - 1] : null; // Unused for now

  // Estimate "Ideal Execution" based on month index (linear).
  const monthsPassed = currentMonthIndex + 1;
  const idealLinearRate = (monthsPassed / 12) * 100;

  // Current Month Status
  const currentMonthScenario = useMemo(() => {
    if (!currentMonthData) return null;

    const value = currentMonthData.consumption;
    const avg = averageConsumption;
    const deviation = value - avg;
    const percentDiff = avg > 0 ? (deviation / avg) * 100 : 0;

    let status = "Na Média";
    let color = "text-yellow-600";
    if (percentDiff > 20) { status = "Alto Consumo"; color = "text-red-600"; }
    else if (percentDiff < -20) { status = "Baixo Consumo"; color = "text-blue-600"; }
    else { status = "Estável"; color = "text-green-600"; }

    return { value, status, color, percentDiff };
  }, [currentMonthData, averageConsumption]);

  // 4. Alerts Generation
  const alerts = useMemo(() => {
    const list: any[] = []; // Explicitly typed as any[] to allow custom props

    // Contract Stats Calculation
    const today = new Date();
    let vigentes = 0;
    let vencendo = 0;
    let vencidos = 0;

    ugrContracts.forEach((c: any) => {
      if (!c.Data_Vigencia_Fim) return;
      const days = (new Date(c.Data_Vigencia_Fim).getTime() - today.getTime()) / (1000 * 3600 * 24);
      if (days < 0) vencidos++;
      else if (days < 90) vencendo++;
      else vigentes++;
    });

    const contractStats = { vigentes, vencendo, vencidos };

    // Execution Alerts with Contract Info attached
    if (executionRate < idealLinearRate - 15) {
      list.push({
        type: 'warning',
        title: 'Execução Lenta',
        message: `UGR está ${Math.round(idealLinearRate - executionRate)}% abaixo da meta linear. Risco de devolução de recurso.`,
        contractStats
      });
    } else if (executionRate > idealLinearRate + 15) {
      list.push({
        type: 'warning',
        title: 'Execução Acelerada',
        message: `Consumo ${Math.round(executionRate - idealLinearRate)}% acima da meta. Risco de falta de saldo no fim do ano.`,
        contractStats
      });
    } else {
      list.push({
        type: 'success',
        title: 'Execução Saudável',
        message: 'Ritmo de gastos alinhado com o período do ano.',
        contractStats
      });
    }

    // Balance Alerts
    if (balance < 0) {
      list.push({ type: 'critical', title: 'Saldo Negativo', message: 'Despesas superam o orçamento estimado.' });
    }

    // Contract Alerts (Specific High Priority)
    if (vencendo > 0) {
      list.push({ type: 'warning', title: 'Atenção aos Contratos', message: `${vencendo} contratos vencem em menos de 90 dias.` });
    }

    return list;
  }, [executionRate, idealLinearRate, balance, ugrContracts]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  if (!currentUGR) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Detalhes por UGR</h1>
            <p className="text-slate-600 mt-1">Selecione uma UGR para visualizar a inteligência orçamentária.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(ugrData || []).map((ugr: any) => (
              <Card
                key={ugr.UGR}
                className="cursor-pointer hover:shadow-lg transition-shadow border-l-4 border-l-transparent hover:border-l-blue-500"
                onClick={() => setSelectedUGR(ugr.UGR)}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-bold">{ugr.UGR}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs text-slate-500">Orçamento</p>
                      <p className="font-bold text-slate-800">{formatCurrency(ugr.Total_Anual_Estimado)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Execução</p>
                      <p className={`font-bold ${ugr.Percentual_Execucao > 75 ? 'text-green-600' : 'text-blue-600'}`}>
                        {ugr.Percentual_Execucao.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header & Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <Button
              onClick={() => {
                if (ugrFromUrl) setLocation("/charts/ecosystem");
                else setSelectedUGR(null);
              }}
              variant="ghost"
              className="pl-0 hover:bg-transparent hover:text-blue-600 mb-1"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar ao Ecossistema
            </Button>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">{currentUGR}</h1>
            <p className="text-slate-500 font-medium">Painel de Inteligência e Decisão</p>
          </div>

          <div className="flex gap-2">
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm text-center">
              <p className="text-[10px] uppercase font-bold text-slate-400">Ano Ref</p>
              <p className="font-bold text-slate-700">{referenceYear || 2024}</p>
            </div>
          </div>
        </div>

        {/* 1. Executive Summary / Alerts Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {alerts.map((alert, idx) => (
            <Card key={idx} className={`border-l-4 ${alert.type === 'warning' ? 'border-l-yellow-500 bg-yellow-50/50' :
              alert.type === 'critical' ? 'border-l-red-500 bg-red-50/50' :
                'border-l-green-500 bg-green-50/50'
              }`}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  {alert.type === 'warning' && <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />}
                  {alert.type === 'critical' && <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />}
                  {alert.type === 'success' && <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />}
                  <div>
                    <h4 className={`font-bold text-sm ${alert.type === 'warning' ? 'text-yellow-800' :
                      alert.type === 'critical' ? 'text-red-800' :
                        'text-green-800'
                      }`}>{alert.title}</h4>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                </div>

                {/* Contract Mind Map Trigger */}
                {/* Contract Mind Map removed per user request */}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ... Rest of the components ... */}

        {/* 2. Main KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg">
            <CardContent className="p-5">
              <p className="text-blue-100 text-xs font-medium uppercase tracking-wider">Previsão anual da Despesa</p>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-2xl font-bold">{formatCurrency(totalBudget)}</span>
              </div>
              <div className="mt-4 h-1 bg-blue-500/50 rounded-full overflow-hidden">
                <div className="h-full bg-white/30 w-full" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 relative group flex flex-col items-center text-center">
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] px-2 py-1 rounded max-w-[200px] z-10 text-center">
                Soma de Empenhos (reserva para este ano) + Restos a Pagar (dívidas de anos anteriores). Impacta o saldo disponível.
              </div>
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider w-full text-left flex items-center gap-1">
                Total Empenhado <span className="text-[9px] bg-slate-100 px-1 rounded text-slate-400">(Empenho + RAP)</span>
              </p>

              <div className="mt-2 text-center w-full">
                <span className="text-2xl font-bold text-slate-900 block">{formatCurrency(totalExecuted)}</span>

                <div className="flex flex-col items-center justify-center mt-2">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${executionRate > 75 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                    {executionRate.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5">do total anual</span>
                </div>
              </div>

              <div className="mt-4 h-1 bg-slate-100 rounded-full overflow-hidden w-full">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min(executionRate, 100)}%` }} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Previsão da despesa mês atual ({currentMonthData?.month || 'N/A'})</p>
              {currentMonthScenario ? (
                <>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-xl font-bold text-slate-900">{formatCurrency(currentMonthScenario.value)}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-xs">
                    <span className={`font-bold ${currentMonthScenario.color}`}>
                      {currentMonthScenario.status}
                    </span>
                    <span className="text-slate-400">
                      ({currentMonthScenario.percentDiff > 0 ? '+' : ''}{currentMonthScenario.percentDiff.toFixed(0)}% vs média)
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400 mt-2">Sem dados para este mês.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">A Empenhar</p>
              <div className="flex items-baseline gap-1 mt-2">
                <span className={`text-2xl font-bold ${balance < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {formatCurrency(balance)}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Livre para execução</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Cenário Fim de Ano</p>
              <div className="flex items-baseline gap-1 mt-2">
                <span className={`text-xl font-bold ${projectedBalance < 0 ? 'text-red-500' : 'text-slate-900'}`}>
                  {formatCurrency(projectedBalance)}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {projectedBalance < 0 ? "Projeção de Déficit" : "Projeção de Superávit"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 3. Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Burn-up Chart */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                Curva de Execução (Burn-up)
              </CardTitle>
              <CardDescription>Acumulado Mensal vs Orçamento Total</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyData}>
                    <defs>
                      <linearGradient id="execFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tickFormatter={(val) => `R$${(val / 1000000).toFixed(0)}M`} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip
                      formatter={(val: number) => formatCurrency(val)}
                      labelStyle={{ color: '#1e293b', fontWeight: 'bold' }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="accumulated"
                      name="Execução Acumulada"
                      stroke="#10b981"
                      fillOpacity={1}
                      fill="url(#execFill)"
                      strokeWidth={3}
                    />
                    <Line
                      type="monotone"
                      dataKey="budgetLine"
                      name="Teto Orçamentário"
                      stroke="#94a3b8"
                      strokeDasharray="5 5"
                      dot={false}
                      strokeWidth={2}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Consumption Bar Chart */}
          <Card className="border-0 shadow-md">
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Consumo Mensal
              </CardTitle>
              <CardDescription>Gasto efetivo mês a mês</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis tickFormatter={(val) => `R$${(val / 1000).toFixed(0)}k`} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip formatter={(val: number) => formatCurrency(val)} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="consumption" name="Gasto Mensal" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 4. Strategic Contracts View */}
        <Card className="border-0 shadow-md overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-slate-800">Detalhamento de Despesas e Contratos</CardTitle>
              <CardDescription>Análise individualizada por item de despesa</CardDescription>
            </div>
            <div className="text-xs text-slate-500 bg-white px-3 py-1 rounded border border-slate-200">
              {ugrContracts.length} itens listados
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50/80 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 font-bold">Item & Status</th>
                    <th className="px-6 py-3 font-bold text-right" title="Orçamento disponível (RAP + Empenho)">Total Empenhado (RAP+Empenho)</th>
                    <th className="px-6 py-3 font-bold text-right text-blue-700 bg-blue-50/50" title="Meta de Gasto Mensal (Orçamento Total / 12)">Média mensal da despesa</th>
                    {/* Removed Header */}
                    <th className="px-6 py-3 font-bold text-center" title="Até quando o recurso dura se gastar exatamente o Teto Mensal">Durabilidade (meses com cobertura de empenho)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ugrContracts
                    .sort((a: any, b: any) => b.Total_Anual_Estimado - a.Total_Anual_Estimado)
                    .map((contract: any, idx: number) => {
                      // --- DEFINITIONS ---
                      const budget = contract.Total_Anual_Estimado || 0;
                      const resources = contract.Total_Empenho_RAP || 0; // "O que tenho"

                      // Hypothetical Ideal Rate (Teto)
                      const idealMonthlyCap = budget > 0 ? budget / 12 : 0;

                      // --- PROJECTIONS (Based on Hypothetical Teto) ---

                      // 1. Durability: How long does 'resources' last if we spend 'idealMonthlyCap' per month?
                      const monthsCovered = idealMonthlyCap > 0 ? (resources / idealMonthlyCap) : 0;

                      const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

                      const fullMonths = Math.floor(monthsCovered);
                      const lastFullMonthIndex = fullMonths - 1; // 0-based

                      // Calculate partial remaining for the next month
                      const remainder = resources - (fullMonths * idealMonthlyCap);
                      const missingForNext = idealMonthlyCap - remainder;

                      let durabilityText = "";
                      let durabilitySubtext = "";

                      if (lastFullMonthIndex >= 11) {
                        durabilityText = "Cobre o Ano Todo";
                        durabilitySubtext = `Sobra: ${formatCurrency(remainder)}`;
                      } else {
                        const lastMonthName = lastFullMonthIndex >= 0 ? monthNames[lastFullMonthIndex] : "Nenhum";
                        const nextMonthName = monthNames[lastFullMonthIndex + 1];

                        if (lastFullMonthIndex < 0) {
                          // Doesn't even cover 1 month fully
                          durabilityText = "Não cobre 1 mês";
                          durabilitySubtext = `Tem ${formatCurrency(resources)} / Teto ${formatCurrency(idealMonthlyCap)}`;
                        } else {
                          durabilityText = `Até ${lastMonthName}`;
                          // e.g. "Para Mai: Tem 50k / Falta 50k"
                          durabilitySubtext = `Para ${nextMonthName}: Tem ${formatCurrency(remainder)} / Falta ${formatCurrency(missingForNext)}`;
                        }
                      }

                      // 2. Supplementation: How much is missing to reach the Total Budget?
                      const gap = budget - resources;
                      const needsSupplementation = gap > 0;

                      // --- STATUS & VALIDITY ---
                      const today = new Date();
                      const vigenciaFim = contract.Data_Vigencia_Fim ? new Date(contract.Data_Vigencia_Fim) : null;
                      let statusLabel = "Indefinido";
                      let statusColor = "bg-slate-100 text-slate-500";
                      let validityText = "";

                      if (vigenciaFim) {
                        const daysLeft = (vigenciaFim.getTime() - today.getTime()) / (1000 * 3600 * 24);
                        if (daysLeft < 0) {
                          statusLabel = "Vencido";
                          statusColor = "bg-red-100 text-red-700";
                          validityText = `Venceu em ${vigenciaFim.toLocaleDateString()}`;
                        } else if (daysLeft < 90) {
                          statusLabel = "Atenção";
                          statusColor = "bg-amber-100 text-amber-700";
                          validityText = `Vence em ${Math.ceil(daysLeft)} dias (${vigenciaFim.toLocaleDateString()})`;
                        } else {
                          statusLabel = "Vigente";
                          statusColor = "bg-green-100 text-green-700";
                          validityText = `Válido até ${vigenciaFim.toLocaleDateString()}`;
                        }
                      }

                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-6 py-4 font-medium text-slate-900 max-w-[250px]">
                            <div className="flex flex-col gap-1">
                              <span className="truncate font-bold" title={contract.Despesa}>{contract.Despesa}</span>
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-400 font-normal">{contract.UGR}</span>
                                  {vigenciaFim && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${statusColor}`}>
                                      {statusLabel}
                                    </span>
                                  )}
                                </div>
                                {validityText && (
                                  <span className="text-[10px] text-slate-500 font-medium">
                                    {validityText}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums font-bold text-slate-700">
                            {formatCurrency(resources)}
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-blue-700 bg-blue-50/30 border-l border-r border-blue-100 font-bold">
                            {formatCurrency(idealMonthlyCap)}
                          </td>
                          {/* Removed Suplementação Anual Column */}
                          <td className="px-6 py-4 text-center">
                            <div className={`flex flex-col items-center p-1.5 rounded border shadow-sm ${needsSupplementation ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                              <span className={`text-xs font-bold uppercase tracking-tight ${needsSupplementation ? 'text-amber-900' : 'text-emerald-900'}`}>
                                {durabilityText}
                              </span>
                              {lastFullMonthIndex < 11 && (
                                <span className={`text-[10px] mt-1 text-center font-bold whitespace-nowrap ${needsSupplementation ? 'text-amber-700' : 'text-emerald-700'}`}>
                                  {durabilitySubtext}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout >
  );
}
