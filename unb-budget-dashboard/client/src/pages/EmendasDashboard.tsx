import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ArrowDownRight, ArrowUpRight, Filter, RefreshCcw } from "lucide-react";

type EmendaRow = {
  pi?: string;
  campus?: string;
  gestor?: string;
  processo?: string;
  descricao?: string;
  gnd?: string;
  grupo_despesa?: string;
  dotacao_loa?: number;
  credito_disponivel?: number;
  despesas_empenhadas?: number;
  saldo_disponivel?: number;
  valor_bloqueado?: number;
  valor_contingenciado?: number;
  credito_planejado?: number;
  valor_disponivel?: number;
  credito_disponivel_ploa?: number;
  custos_indiretos?: number;
  total_empenhado_ploa?: number;
};

const formatCurrency = (value?: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

const chartConfig = {
  credito: {
    label: "Crédito",
    color: "hsl(var(--chart-1))",
  },
  empenhado: {
    label: "Empenhado",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

export default function EmendasDashboard() {
  const { data: kpis } = trpc.emendas.getKPIs.useQuery();
  const { data: rows, isLoading: rowsLoading, refetch } = trpc.emendas.getAllData.useQuery();

  const [piFilter, setPiFilter] = useState<string>("");
  const [campusFilter, setCampusFilter] = useState<string>("");
  const [processoFilter, setProcessoFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const piOptions = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach((row: EmendaRow) => {
      if (row.pi) set.add(row.pi);
    });
    return Array.from(set).sort();
  }, [rows]);

  const campusOptions = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach((row: EmendaRow) => {
      if (row.campus) set.add(row.campus);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows: EmendaRow[] = useMemo(() => {
    if (!rows) return [];
    const term = searchTerm.trim().toLowerCase();
    const procTerm = processoFilter.trim().toLowerCase();

    return rows.filter((row: EmendaRow) => {
      if (piFilter && row.pi !== piFilter) return false;
      if (campusFilter && row.campus !== campusFilter) return false;
      if (procTerm && !String(row.processo || "").toLowerCase().includes(procTerm)) return false;
      if (term) {
        const haystack = `${row.descricao || ""} ${row.gestor || ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, piFilter, campusFilter, processoFilter, searchTerm]);

  const filteredTotals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.credito += row.credito_disponivel || 0;
        acc.empenhado += row.despesas_empenhadas || 0;
        acc.dotacao += row.dotacao_loa || 0;
        acc.bloqueado += row.valor_bloqueado || 0;
        acc.contingenciado += row.valor_contingenciado || 0;
        return acc;
      },
      { credito: 0, empenhado: 0, dotacao: 0, bloqueado: 0, contingenciado: 0 }
    );
  }, [filteredRows]);

  const campusChartData = useMemo(() => {
    const map = new Map<string, { campus: string; credito: number; empenhado: number }>();
    filteredRows.forEach((row) => {
      const key = row.campus || "Não informado";
      const current = map.get(key) || { campus: key, credito: 0, empenhado: 0 };
      current.credito += row.credito_disponivel || 0;
      current.empenhado += row.despesas_empenhadas || 0;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.credito - a.credito).slice(0, 8);
  }, [filteredRows]);

  const menuConfig = [
    {
      key: "emendas",
      title: "📊 Emendas de Bancada",
      items: [
        { href: "/emendas", label: "Visão geral", icon: <ArrowUpRight className="w-4 h-4" /> },
      ],
    },
  ];

  return (
    <DashboardLayout menuConfig={menuConfig}>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500 font-semibold">Emendas 2025</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900">Emendas de Bancada</h1>
            <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
              Crédito vs Empenho atualizados
            </Badge>
          </div>
          <p className="text-slate-600 max-w-3xl">
            Painel consolidado entre as planilhas Emendas_2025 e Emendas2025PLOAfixa, com foco em crédito disponível,
            despesas empenhadas e dotação das emendas por PI e campus.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Card className="shadow-md border-0 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wide">Crédito disponível</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-bold">{formatCurrency(filteredTotals.credito || kpis?.credito_disponivel)}</div>
              <p className="text-sm text-emerald-50">
                Dotação LOA: {formatCurrency(filteredTotals.dotacao || kpis?.dotacao_loa)}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-md border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 uppercase tracking-wide">Despesas empenhadas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-bold text-slate-900">
                {formatCurrency(filteredTotals.empenhado || kpis?.despesas_empenhadas)}
              </div>
              <p className="text-sm text-slate-500 flex items-center gap-1">
                {kpis?.percentual_execucao ? (
                  <>
                    <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                    {kpis.percentual_execucao.toFixed(1)}% executado
                  </>
                ) : (
                  "Execução consolidada"
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-md border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 uppercase tracking-wide">Saldo disponível</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-bold text-slate-900">
                {formatCurrency((filteredTotals.credito - filteredTotals.empenhado) || kpis?.saldo_disponivel)}
              </div>
              <p className="text-sm text-slate-500 flex items-center gap-1">
                {filteredTotals.empenhado > filteredTotals.credito ? (
                  <>
                    <ArrowDownRight className="w-4 h-4 text-rose-500" />
                    Crédito negativo
                  </>
                ) : (
                  "Crédito x empenho"
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-md border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500 uppercase tracking-wide">Bloqueios e conting.</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-2xl font-bold text-slate-900">{formatCurrency(filteredTotals.bloqueado || kpis?.valor_bloqueado)}</div>
              <p className="text-sm text-slate-500">
                Contingenciado: {formatCurrency(filteredTotals.contingenciado || kpis?.valor_contingenciado)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm border-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <Filter className="w-4 h-4 text-emerald-500" />
              Filtros rápidos
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Select value={piFilter} onValueChange={setPiFilter}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Filtrar por PI" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os PI</SelectItem>
                {piOptions.map((pi) => (
                  <SelectItem key={pi} value={pi}>
                    {pi}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={campusFilter} onValueChange={setCampusFilter}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Filtrar por campus/UGR" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os campus</SelectItem>
                {campusOptions.map((campus) => (
                  <SelectItem key={campus} value={campus}>
                    {campus}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              placeholder="Processo / SEI"
              value={processoFilter}
              onChange={(e) => setProcessoFilter(e.target.value)}
            />
            <Input
              placeholder="Busca por descrição ou gestor"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="shadow-sm border-0 xl:col-span-2">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-slate-800">Crédito x Empenho por campus</CardTitle>
                <p className="text-sm text-slate-500">Top 8 campus com maior crédito disponível.</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
                <RefreshCcw className="w-4 h-4" /> Atualizar
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-[360px]">
                {rowsLoading ? (
                  <div className="flex items-center justify-center h-full text-slate-500">Carregando dados...</div>
                ) : (
                  <ChartContainer config={chartConfig}>
                    <ResponsiveContainer>
                      <BarChart data={campusChartData} margin={{ left: 0, right: 0, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="campus" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(value) => formatCurrency(value).replace("R$", "")} />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value))} />} />
                        <Legend />
                        <Bar dataKey="credito" name="Crédito" fill="var(--color-credito)" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="empenhado" name="Empenhado" fill="var(--color-empenhado)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-slate-800">Destaques</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Maior crédito</p>
                <div className="text-lg font-semibold text-emerald-900">
                  {campusChartData[0]?.campus || "—"}
                </div>
                <p className="text-sm text-emerald-700">
                  {formatCurrency(campusChartData[0]?.credito || 0)} disponíveis
                </p>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold">Maior execução</p>
                <div className="text-lg font-semibold text-amber-900">
                  {campusChartData
                    .slice()
                    .sort((a, b) => b.empenhado - a.empenhado)[0]?.campus || "—"}
                </div>
                <p className="text-sm text-amber-700">
                  Empenhado {formatCurrency(campusChartData
                    .slice()
                    .sort((a, b) => b.empenhado - a.empenhado)[0]?.empenhado || 0)}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Total de PI filtrados</p>
                <div className="text-lg font-semibold text-slate-900">{filteredRows.length}</div>
                <p className="text-sm text-slate-600">Resultados segundo filtros aplicados.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-slate-800">Lista de PI e processos</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 uppercase text-xs">
                  <th className="pb-3 pr-4">PI</th>
                  <th className="pb-3 pr-4">Campus</th>
                  <th className="pb-3 pr-4">Processo</th>
                  <th className="pb-3 pr-4">Despesa / Destinação</th>
                  <th className="pb-3 pr-4">Gestor</th>
                  <th className="pb-3 pr-4">GND</th>
                  <th className="pb-3 pr-4 text-right">Crédito</th>
                  <th className="pb-3 pr-4 text-right">Empenhado</th>
                  <th className="pb-3 pr-4 text-right">Saldo</th>
                  <th className="pb-3 pr-4 text-right">Dotação LOA</th>
                </tr>
              </thead>
              <tbody>
                {rowsLoading ? (
                  <tr>
                    <td colSpan={10} className="text-center py-6 text-slate-500">
                      Carregando registros...
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-6 text-slate-500">
                      Nenhum PI encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={`${row.pi}-${idx}`} className="border-t border-slate-100">
                      <td className="py-3 pr-4 font-semibold text-slate-900">{row.pi || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.campus || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.processo || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.descricao || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.gestor || "—"}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.gnd || row.grupo_despesa || "—"}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-700">
                        {formatCurrency(row.credito_disponivel)}
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-800">
                        {formatCurrency(row.despesas_empenhadas)}
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-800">
                        {formatCurrency((row.credito_disponivel || 0) - (row.despesas_empenhadas || 0))}
                      </td>
                      <td className="py-3 pr-4 text-right text-slate-800">
                        {formatCurrency(row.dotacao_loa)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
