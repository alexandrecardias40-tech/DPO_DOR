import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
   BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
   AreaChart, Area, Legend, ReferenceLine
} from "recharts";
import DashboardLayout from "@/components/DashboardLayout";
import { useMemo, useState } from "react";
import {
   ArrowUpRight, ArrowDownRight, AlertTriangle, Calendar,
   Target, TrendingUp, DollarSign, Wallet
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Comparisons() {
   const { data: ugrAnalysis, isLoading: ugrLoading } = trpc.budget.getUGRAnalysis.useQuery();
   const { data: monthlyData, isLoading: monthlyLoading } = trpc.budget.getMonthlyConsumption.useQuery();

   const [viewMode, setViewMode] = useState<'budget' | 'execution'>('execution');

   const formatCurrency = (value: number) => {
      return new Intl.NumberFormat('pt-BR', {
         style: 'currency',
         currency: 'BRL',
         minimumFractionDigits: 0,
         maximumFractionDigits: 0,
      }).format(value);
   };

   const PROCESSED_DATA = useMemo(() => {
      if (!ugrAnalysis) return null;

      // 1. Calculate Global Context
      const totalBudget = ugrAnalysis.reduce((acc, curr) => acc + (curr.Total_Anual_Estimado || 0), 0);
      // Use the separated fields if available (fallback to Total_Empenho_RAP for safety)
      const currentYearExecution = ugrAnalysis.reduce((acc, curr) => acc + (curr.Saldo_Empenhos_2025 || 0), 0);
      const legacyExecution = ugrAnalysis.reduce((acc, curr) => acc + (curr.Saldo_Empenhos_RAP || 0), 0);
      const totalCommitted = ugrAnalysis.reduce((acc, curr) => acc + (curr.Total_Empenho_RAP || 0), 0);

      // 2. Prepare Horizontal Bar Data (Top 10 by Budget for readability)
      const sortedByBudget = [...ugrAnalysis]
         .sort((a, b) => b.Total_Anual_Estimado - a.Total_Anual_Estimado)
         .slice(0, 15); // Top 15 largest units

      // 3. Prepare Monthly Data (Sort by Month & Filter Future)
      const now = new Date();
      // Safe check: allow current month, disallow future months.

      const sortedMonthly = monthlyData
         ? [...monthlyData]
            .filter((m: any) => {
               const mDate = new Date(m.Mes);
               // Use start of month for both.
               // We want to SHOW data up to current month.
               // If mDate is in future relative to now, exclude.
               // We'll trust the month/year.
               // Use a simpler string comparison YYYY-MM if possible, but Date is fine.
               // Just ensure we don't accidentally exclude "today".

               // Create "End of Current Month" date
               const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

               // Add 12 hours to rowDate to avoid timezone shifting to previous month on display
               const rowDate = new Date(mDate.getFullYear(), mDate.getMonth(), 1, 12);

               return rowDate <= endOfCurrentMonth;
            })
            .sort((a: any, b: any) => a.Mes.localeCompare(b.Mes))
            .map((m: any) => ({
               ...m,
               Mês: new Date(m.Mes).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase(),
               accumulated: 0 // Will calculate below
            }))
         : [];

      // Calculate accumulated
      let accum = 0;
      const monthlyWithAccumulated = sortedMonthly.map(m => {
         accum += m.Consumo_Mensal;
         return { ...m, accumulated: accum };
      });

      // Calculate Highlights (Max Month)
      // Find the month with MAX execution, not just the last one.
      const monthWithMaxExecution = [...monthlyWithAccumulated].sort((a, b) => b.Consumo_Mensal - a.Consumo_Mensal)[0];

      return {
         totalBudget,
         currentYearExecution,
         legacyExecution,
         totalCommitted,
         sortedByBudget,
         monthlyWithAccumulated,
         monthWithMaxExecution
      };
   }, [ugrAnalysis, monthlyData]);

   if (ugrLoading || monthlyLoading || !PROCESSED_DATA) {
      return (
         <DashboardLayout>
            <div className="flex h-screen items-center justify-center bg-slate-50">
               <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-800"></div>
            </div>
         </DashboardLayout>
      );
   }

   const {
      totalBudget, currentYearExecution, legacyExecution, totalCommitted,
      sortedByBudget, monthlyWithAccumulated, monthWithMaxExecution
   } = PROCESSED_DATA;

   // Calculate generic percentage based on total committed for high-level view
   // Corrected: Use the sum of Saldo 2025 + RAP (not totalCommitted which may include other values)
   const actualCommitted = currentYearExecution + legacyExecution;
   const globalRate = totalBudget > 0 ? (actualCommitted / totalBudget) * 100 : 0;

   return (
      <DashboardLayout>
         <div className="space-y-8 pb-12">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-slate-200 pb-6">
               <div>
                  <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Painel de Inteligência Orçamentária</h1>
                  <p className="text-slate-500 mt-2 text-lg">Visão estratégica da execução e tendências mensais.</p>
               </div>
               <div className="flex gap-2 bg-white p-1 rounded-lg border border-slate-200">
                  {/* Simple View Toggle if needed later */}
               </div>
            </div>

            {/* Top KPIs - Using "Clean Stat" Design */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
               <Card className="border-l-4 border-blue-600 shadow-sm">
                  <CardContent className="pt-6">
                     <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-500">Previsão Total das Despesas Institucionais</span>
                        <DollarSign className="w-5 h-5 text-blue-600 opacity-60" />
                     </div>
                     <div className="text-2xl font-bold text-slate-900">{formatCurrency(totalBudget)}</div>
                     <div className="mt-2 text-xs text-slate-400">Previsão Anual</div>
                  </CardContent>
               </Card>

               <Card className="border-l-4 border-emerald-500 shadow-sm">
                  <CardContent className="pt-6">
                     <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-500">Total Empenhado LOA Atual</span>
                        <TrendingUp className="w-5 h-5 text-emerald-500 opacity-60" />
                     </div>
                     <div className="text-2xl font-bold text-slate-900">{formatCurrency(currentYearExecution)}</div>
                     <Progress value={(currentYearExecution / totalBudget) * 100} className="h-1.5 mt-3 bg-emerald-100" indicatorClassName="bg-emerald-500" />
                  </CardContent>
               </Card>

               <Card className="border-l-4 border-amber-500 shadow-sm">
                  <CardContent className="pt-6">
                     <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-500">Restos a Pagar (RAP)</span>
                        <Wallet className="w-5 h-5 text-amber-500 opacity-60" />
                     </div>
                     <div className="text-2xl font-bold text-slate-900">{formatCurrency(legacyExecution)}</div>
                     <div className="mt-2 text-xs text-slate-400">Compromissos de anos anteriores</div>
                  </CardContent>
               </Card>

               <Card className="border-l-4 border-slate-800 shadow-sm bg-slate-50">
                  <CardContent className="pt-6">
                     <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-500">Índice Geral Comprometido</span>
                        <Target className="w-5 h-5 text-slate-800 opacity-60" />
                     </div>
                     <div className="text-3xl font-bold text-slate-900">{globalRate.toFixed(1)}%</div>
                     <div className="mt-2 text-xs text-slate-500">Total (Ano + RAP) / Orçamento</div>
                  </CardContent>
               </Card>
            </div>

            {/* Section 1: Monthly Evolution (The "February" Context) */}
            <Card className="shadow-md border border-slate-200">
               <CardHeader>
                  <div className="flex items-center gap-2">
                     <Calendar className="w-5 h-5 text-blue-600" />
                     <CardTitle>Linha do Tempo: Execução Mensal</CardTitle>
                  </div>
                  <CardDescription>Acompanhe o ritmo de gastos mês a mês para identificar picos e sazonalidades.</CardDescription>
               </CardHeader>
               <CardContent className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={monthlyWithAccumulated} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                           <linearGradient id="colorConsumo" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                           </linearGradient>
                           <linearGradient id="colorAccum" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                           </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="Mês" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={(val) => 'R$' + (val / 1000000).toFixed(0) + ' M'} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip
                           contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                           formatter={(value: number) => formatCurrency(value)}
                        />
                        <Legend iconType="circle" />
                        <Area type="monotone" dataKey="Consumo_Mensal" name="Execução no Mês" stroke="#3b82f6" fillOpacity={1} fill="url(#colorConsumo)" strokeWidth={2} />
                        <Area type="monotone" dataKey="accumulated" name="Execução Acumulada" stroke="#10b981" fillOpacity={0.1} fill="url(#colorAccum)" strokeWidth={2} strokeDasharray="5 5" />
                     </AreaChart>
                  </ResponsiveContainer>
               </CardContent>
            </Card>

            {/* Section 2: Budget vs Execution Ranking (Horizontal Bar) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
               <Card className="lg:col-span-2 shadow-md border border-slate-200">
                  <CardHeader>
                     <div className="flex items-center justify-between">
                        <div>
                           <CardTitle>Top 15 UGRs: Capacidade de Execução</CardTitle>
                           <CardDescription>Comparativo direto entre o orçamento disponível e o valor já comprometido.</CardDescription>
                        </div>
                     </div>
                  </CardHeader>
                  <CardContent className="h-[600px]">
                     <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                           data={sortedByBudget}
                           layout="vertical"
                           margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                           barCategoryGap={2}
                           barGap={0}
                        >
                           <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                           <XAxis type="number" hide />
                           <YAxis
                              type="category"
                              dataKey="UGR"
                              width={150}
                              tick={{ fontSize: 11, fill: '#64748b' }}
                              tickLine={false}
                              interval={0}
                           />
                           <Tooltip cursor={{ fill: '#f8fafc' }} content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                 const data = payload[0].payload;
                                 return (
                                    <div className="bg-slate-900 text-white text-xs p-3 rounded-lg shadow-xl">
                                       <div className="font-bold text-sm mb-2 border-b border-slate-700 pb-1">{data.UGR}</div>
                                       <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                          <span className="text-slate-400">Orçamento:</span>
                                          <span className="font-mono text-right">{formatCurrency(data.Total_Anual_Estimado)}</span>
                                          <span className="text-blue-400">Executado:</span>
                                          <span className="font-mono text-right text-blue-300">{formatCurrency(data.Total_Empenho_RAP)}</span>
                                          <span className="text-slate-400">Saldo:</span>
                                          <span className="font-mono text-right text-green-400">{formatCurrency(data.Total_Anual_Estimado - data.Total_Empenho_RAP)}</span>
                                       </div>
                                    </div>
                                 )
                              }
                              return null;
                           }} />
                           <Legend verticalAlign="top" align="right" iconType="circle" />
                           <Bar dataKey="Total_Anual_Estimado" name="Despesa Anual" fill="#e2e8f0" radius={[0, 4, 4, 0]} barSize={20} />
                           <Bar dataKey="Total_Empenho_RAP" name="Empenhado Atual" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} className="opacity-90 hover:opacity-100" />
                        </BarChart>
                     </ResponsiveContainer>
                  </CardContent>
               </Card>

               {/* Side Panel: Analysis Insights */}
               <div className="space-y-6">
                  <Card className="bg-slate-900 text-slate-50 border-0 shadow-lg">
                     <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                           <Target className="w-5 h-5 text-emerald-400" />
                           Destaques do Mês
                        </CardTitle>
                     </CardHeader>
                     <CardContent className="space-y-4">
                        <div className="p-3 bg-white/10 rounded-lg border border-white/5">
                           <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Maior Execução</div>
                           <div className="font-bold text-lg text-emerald-300">
                              {monthWithMaxExecution ? monthWithMaxExecution.Mês : '-'}
                           </div>
                           <div className="text-sm text-slate-300 mt-1">
                              {monthWithMaxExecution ? formatCurrency(monthWithMaxExecution.Consumo_Mensal) : '-'}
                           </div>
                        </div>

                        <div className="p-3 bg-white/10 rounded-lg border border-white/5">
                           <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">Média Mensal Global</div>
                           <div className="font-bold text-lg text-blue-300">
                              {formatCurrency((monthlyWithAccumulated.reduce((a, b) => a + b.Consumo_Mensal, 0) / (monthlyWithAccumulated.length || 1)))}
                           </div>
                        </div>
                     </CardContent>
                  </Card>

                  <Card className="border border-amber-200 bg-amber-50">
                     <CardHeader>
                        <CardTitle className="text-amber-800 text-base flex items-center gap-2">
                           <AlertTriangle className="w-4 h-4" />
                           Atenção: Fevereiro
                        </CardTitle>
                     </CardHeader>
                     <CardContent>
                        <p className="text-sm text-amber-800/80 leading-relaxed">
                           Os índices atuais refletem o início do exercício financeiro.
                           <br />
                           Valores de <strong>RAP (Restos a Pagar)</strong> podem inflar a execução aparente.
                           Utilize o gráfico de "Evolução Mensal" para isolar o consumo real deste ano.
                        </p>
                     </CardContent>
                  </Card>
               </div>
            </div>
         </div>
      </DashboardLayout>
   );
}
