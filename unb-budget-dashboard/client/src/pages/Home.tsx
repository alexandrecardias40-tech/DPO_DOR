import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type PieLabelRenderProps,
} from "recharts";
import { X } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];
const MONTH_LABELS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "vencendo", label: "Vencendo (2025)" },
  { value: "expired", label: "Expirados" },
  { value: "attention", label: "Em atenção" },
  { value: "neutral", label: "Sem vigência" },
];

export default function Home() {
  const { data: kpis } = trpc.budget.getKPIs.useQuery();
  const { data: allData } = trpc.budget.getAllData.useQuery();
  const { data: monthlyData } = trpc.budget.getMonthlyConsumption.useQuery();
  const { data: ugrData } = trpc.budget.getUGRAnalysis.useQuery();
  const { data: expiringContracts } = trpc.budget.getExpiringContracts.useQuery();
  const { data: expiredContracts } = trpc.budget.getExpiredContracts.useQuery();

  const [selectedPi, setSelectedPi] = useState<string>("");
  const [selectedContract, setSelectedContract] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const hasActiveFilters = Boolean(selectedPi || selectedContract);
  const splitLabel = useCallback((label: string) => {
    if (!label) return ["Sem nome"];
    const words = label.split(" ");
    const lines: string[] = [];
    let current = "";

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= 18) {
        current = candidate;
        return;
      }
      if (current) {
        lines.push(current);
      }
      current = word;
    });

    if (current) {
      lines.push(current);
    }

    return lines;
  }, []);

  const piOptions = useMemo(() => {
    if (!allData) return [];
    const base = selectedContract
      ? allData.filter((item: any) => (item["nº  Contrato"] || "") === selectedContract)
      : allData;
    const options = new Set(base.map((item: any) => item.PI_2025).filter(Boolean));
    return Array.from(options).sort();
  }, [allData, selectedContract]);

  const contractOptions = useMemo(() => {
    if (!allData) return [];
    const base = selectedPi ? allData.filter((item: any) => item.PI_2025 === selectedPi) : allData;
    const options = new Set(base.map((item: any) => (item["nº  Contrato"] || "")).filter(Boolean));
    return Array.from(options).sort();
  }, [allData, selectedPi]);

  // Filter data based on active filters
  const filteredData = useMemo(() => {
    if (!allData) return [];
    return allData.filter((item: any) => {
      if (selectedPi && item.PI_2025 !== selectedPi) return false;
      if (selectedContract && (item["nº  Contrato"] || "") !== selectedContract) return false;
      return true;
    });
  }, [allData, selectedPi, selectedContract]);

  // Filter UGR data based on selected UOrgs
  const filteredUgrData = useMemo(() => {
    if (!ugrData) return [];
    if (!hasActiveFilters) return ugrData;
    const allowed = new Set(filteredData.map((item: any) => item.UGR));
    return ugrData.filter((item: any) => allowed.has(item.UGR));
  }, [ugrData, filteredData, hasActiveFilters]);

  const pieData = useMemo(() => {
    const source = (filteredUgrData || []).filter((item: any) => (item.Total_Anual_Estimado || 0) > 0);
    const total = source.reduce((sum: number, item: any) => sum + (item.Total_Anual_Estimado || 0), 0);
    if (!total) {
      return source.map((item: any) => ({
        ...item,
        displayName: item.UGR,
        percentValue: 0,
      }));
    }
    return source.map((item: any) => {
      const value = item.Total_Anual_Estimado || 0;
      const percent = (value / total) * 100;
      return {
        ...item,
        displayName: item.UGR,
        percentValue: percent,
      };
    });
  }, [filteredUgrData]);
  const renderPieLabel = useCallback((props: PieLabelRenderProps) => {
    if (!pieData || pieData.length === 0) return null;
    const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, index = 0 } = props;
    const entry = pieData[index];
    if (!entry) return null;

    const RAD = Math.PI / 180;
    const labelRadius = outerRadius + 42;
    const x = cx + labelRadius * Math.cos(-midAngle * RAD);
    const y = cy + labelRadius * Math.sin(-midAngle * RAD);
    const textAnchor = x > cx ? "start" : "end";

    const labelLines = splitLabel(entry.displayName || entry.UGR || `UGR ${index + 1}`);
    const percentValue = entry.percentValue ?? 0;
    const formattedPercent = `${percentValue.toFixed(percentValue >= 10 ? 0 : 1)}%`;

    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        fill="#334155"
        fontSize="9px"
        fontWeight={500}
      >
        {labelLines.map((line, lineIndex) => (
          <tspan key={`label-line-${lineIndex}`} x={x} dy={lineIndex === 0 ? "0" : "1.1em"}>
            {line}
          </tspan>
        ))}
        <tspan x={x} dy="1.1em" fill="#0f172a" fontSize="8px" fontWeight={600}>
          {formattedPercent}
        </tspan>
      </text>
    );
  }, [pieData, splitLabel]);

  // Filter monthly data based on selected UOrgs
  const filteredMonthlyData = useMemo(() => {
    if (!monthlyData) return [];
    if (!hasActiveFilters) return monthlyData;
    return monthlyData.map((month: any) => {
      const monthKey = `${month.Mês} 00:00:00`;
      const filteredConsumption = filteredData.reduce((sum: number, item: any) => {
        return sum + (item[monthKey] || 0);
      }, 0);
      return {
        ...month,
        Consumo_Mensal: filteredConsumption,
      };
    });
  }, [monthlyData, filteredData, hasActiveFilters]);

  // Calculate totals from filtered data
  const totals = useMemo(() => {
    if (!filteredData || filteredData.length === 0) {
      return {
        valor_contrato: 0,
        media_mensal: 0,
        total_estimado: 0,
        saldo_empenhos_2025: 0,
        saldo_empenhos_rap: 0,
        total_rap_empenho: 0,
        total_necessario: 0,
      };
    }

    const valor_contrato = filteredData.reduce((sum: number, item: any) => sum + (item.Valor_Mensal_Medio_Contrato || 0), 0);
    const media_mensal = valor_contrato / filteredData.length;
    const total_estimado = filteredData.reduce((sum: number, item: any) => sum + (item.Total_Anual_Estimado || 0), 0);
    const saldo_empenhos_2025 = filteredData.reduce((sum: number, item: any) => sum + (item.Saldo_Empenhos_2025 || 0), 0);
    const saldo_empenhos_rap = filteredData.reduce((sum: number, item: any) => sum + (item.Saldo_Empenhos_RAP || 0), 0);
    const total_rap_empenho = saldo_empenhos_2025 + saldo_empenhos_rap;
    const total_necessario = filteredData.reduce((sum: number, item: any) => sum + (item.Total_Necessario || 0), 0);

    return {
      valor_contrato,
      media_mensal,
      total_estimado,
      saldo_empenhos_2025,
      saldo_empenhos_rap,
      total_rap_empenho,
      total_necessario,
    };
  }, [filteredData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatCurrencyCompact = (value: number) => {
    if (!value) return "—";
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  };

  const formatPiLines = useCallback((pi: string) => {
    if (!pi) return ["—"];
    const trimmed = pi.trim();
    const match = trimmed.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (match) {
      return [match[1].trim(), match[2].trim()];
    }
    if (trimmed.length > 18) {
      const midpoint = Math.ceil(trimmed.length / 2);
      return [trimmed.slice(0, midpoint).trim(), trimmed.slice(midpoint).trim()].filter(Boolean);
    }
    return [trimmed];
  }, []);

  const contractTimeline = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();

    return filteredData.map((item: any, index: number) => {
      const pi = item.PI_2025 || "—";
      const contrato = item["nº  Contrato"] || "—";
      const valorContrato = item.Total_Anual_Estimado || 0;
      const mediaMensal = item.Valor_Mensal_Medio_Contrato || 0;
      const totalRapEmpenho = (item.Total_Empenho_RAP || 0) + (item.Saldo_Empenhos_RAP || 0);
      const expiryDate = item.Data_Vigencia_Fim ? new Date(item.Data_Vigencia_Fim) : null;
      const expiryLabel = expiryDate && !Number.isNaN(expiryDate.getTime())
        ? expiryDate.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
        : "—";
      const expiryMonthIndex = expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate.getMonth() : -1;
      const expiryYear = expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate.getFullYear() : null;

      const statusInfo = (() => {
        if (!expiryDate || Number.isNaN(expiryDate.getTime())) {
          return {
            status: "noDate",
            label: "Sem vigência",
            detail: "Sem data registrada",
            badgeClass: "bg-slate-100 text-slate-600 border border-slate-200",
            isExpired: false,
            tone: "neutral",
          };
        }

        if (expiryYear && expiryYear < currentYear) {
          return {
            status: "expiredPrevious",
            label: `Expirado ${expiryYear}`,
            detail: "Fora do ano corrente",
            badgeClass: "bg-rose-100 text-rose-700 border border-rose-200",
            isExpired: true,
            tone: "expired",
          };
        }

        if (expiryYear === currentYear && expiryDate < today) {
          return {
            status: "expiredCurrent",
            label: "Expirado",
            detail: expiryLabel,
            badgeClass: "bg-rose-600 text-white border border-rose-700 shadow shadow-rose-400/50",
            isExpired: true,
            tone: "expired",
          };
        }

        if (expiryYear === currentYear) {
          return {
            status: "onTrack",
            label: "Vencendo",
            detail: `Vence ${expiryLabel}`,
            badgeClass: "bg-amber-100 text-amber-800 border border-amber-300",
            isExpired: false,
            tone: "vencendo",
          };
        }

        if (expiryYear && expiryYear > currentYear) {
          return {
            status: "future",
            label: "Em atenção",
            detail: `Vence ${expiryLabel}`,
            badgeClass: "bg-amber-50 text-amber-800 border border-amber-200",
            isExpired: false,
            tone: "attention",
          };
        }

        return {
          status: "noDate",
          label: "Sem vigência",
          detail: "",
          badgeClass: "bg-slate-100 text-slate-600 border border-slate-200",
          isExpired: false,
          tone: "neutral",
        };
      })();

      const months = MONTH_LABELS.map((label, monthIndex) => {
        const lower = mediaMensal * monthIndex;
        const upper = lower + mediaMensal;
        let status = "exceeded";
        if (totalRapEmpenho >= upper) status = "ok";
        else if (totalRapEmpenho > lower) status = "partial";
        const amount = Math.max(Math.min(totalRapEmpenho - lower, mediaMensal), 0);
        return {
          label,
          status,
          amount,
          highlight: expiryYear === currentYear && monthIndex === expiryMonthIndex,
        };
      });

      return {
        id: `timeline-${index}-${contrato}-${pi}`,
        pi,
        contrato,
        valorContrato,
        mediaMensal,
        totalRapEmpenho,
        months,
        expiry: expiryLabel,
        statusInfo,
      };
    });
  }, [filteredData]);

  const filteredTimeline = useMemo(() => {
    if (!contractTimeline) return [];
    if (statusFilter === "all") return contractTimeline;
    return contractTimeline.filter((item: any) => item.statusInfo?.tone === statusFilter);
  }, [contractTimeline, statusFilter]);

  const monthStatusClass = (status: string) => {
    if (status === "ok") return "bg-emerald-100 text-emerald-700";
    if (status === "partial") return "bg-amber-100 text-amber-800";
    return "bg-rose-100 text-rose-700";
  };


  const KPICard = ({ title, value }: { title: string; value: string }) => (
    <Card className="bg-white shadow-sm border border-slate-200">
      <CardContent className="p-3">
        <p className="text-xs font-medium text-slate-600">{title}</p>
        <p className="text-sm font-bold text-slate-900 mt-1 truncate">{value}</p>
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Dashboard Orçamentário UnB</h1>
            <p className="text-slate-600 mt-1">Análise de despesas e execução orçamentária - 2025</p>
          </div>
        </div>

        {/* Filtros Melhorados */}
        <Card className="bg-white border border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold">Filtros</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-900">Plano Interno (PI)</label>
              <select
                value={selectedPi}
                onChange={(e) => setSelectedPi(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">Selecione um PI...</option>
                {piOptions.map((pi) => (
                  <option key={pi} value={pi}>
                    {pi}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-900">Contrato</label>
              <select
                value={selectedContract}
                onChange={(e) => setSelectedContract(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">Selecione um contrato...</option>
                {contractOptions.map((contract) => (
                  <option key={contract} value={contract}>
                    {contract}
                  </option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <div className="flex gap-2 pt-2 border-t border-slate-200">
                <Button
                  onClick={() => {
                    setSelectedPi("");
                    setSelectedContract("");
                  }}
                  variant="outline"
                  size="sm"
                >
                  <X className="w-4 h-4 mr-1" />
                  Limpar Seleção
                </Button>
                <span className="text-xs text-slate-600 self-center">
                  {filteredData.length} contrato(s) filtrado(s)
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs Grid - Estilo Detalhado */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="bg-white border-l-4 border-l-blue-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Valor Contrato</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.valor_contrato)}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-white border-l-4 border-l-green-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Média Mensal</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.media_mensal)}</div>
            </CardContent>
          </Card>

          <Card className="bg-white border-l-4 border-l-purple-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Total Estimado</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.total_estimado)}</div>
            </CardContent>
          </Card>

          <Card className="bg-white border-l-4 border-l-yellow-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Saldo 2025</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.saldo_empenhos_2025)}</div>
            </CardContent>
          </Card>

          <Card className="bg-white border-l-4 border-l-pink-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Saldo RAP</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.saldo_empenhos_rap)}</div>
            </CardContent>
          </Card>

          <Card className="bg-white border-l-4 border-l-indigo-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Total RAP+Empenho</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.total_rap_empenho)}</div>
            </CardContent>
          </Card>

          <Card className="bg-white border-l-4 border-l-orange-500">
            <CardHeader className="py-1 px-3">
              <CardTitle className="text-xs font-semibold text-slate-600 tracking-wide uppercase">Total Necessário</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-3 px-3">
              <div className="text-lg font-semibold text-slate-900">{formatCurrency(totals.total_necessario)}</div>
            </CardContent>
          </Card>
        </div>

        {contractTimeline.length > 0 && (
          <Card className="bg-white border border-slate-200 shadow-sm">
            <CardHeader className="pb-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-sm font-bold">Planejamento de Empenho por Contrato</CardTitle>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="text-xs border border-slate-300 rounded-md bg-white px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {STATUS_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-[11px] md:text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 text-left">PI</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-left">Valor Contrato</th>
                    <th className="px-2 py-2 text-left">Média Mensal</th>
                    <th className="px-2 py-2 text-left">Total RAP+Empenho</th>
                    {MONTH_LABELS.map((label) => (
                      <th key={label} className="px-1.5 py-2 text-center">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTimeline.length === 0 ? (
                    <tr>
                      <td colSpan={MONTH_LABELS.length + 5} className="px-4 py-4 text-center text-xs text-slate-500">
                        Nenhum contrato com esse status.
                      </td>
                    </tr>
                  ) : (
                    filteredTimeline.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 text-slate-900 align-top">
                        <td className="px-2 py-2">
                          <div className="flex flex-col leading-tight text-[11px]">
                            {formatPiLines(item.pi || "—").map((segment, segmentIndex) => (
                            <span
                              key={`${item.id}-pi-${segmentIndex}`}
                              className={segmentIndex === 0 ? "font-semibold text-slate-900" : "text-[10px] text-slate-500"}
                            >
                              {segment}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div
                          className={`inline-flex min-w-[120px] flex-col items-start gap-0.5 rounded-md px-3 py-2 border text-[11px] font-semibold ${item.statusInfo.badgeClass}`}
                        >
                          <span className="uppercase tracking-wide text-[10px]">{item.statusInfo.label}</span>
                          {item.statusInfo.detail && (
                            <span className="text-[10px] font-normal opacity-80">{item.statusInfo.detail}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{formatCurrency(item.valorContrato)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{formatCurrency(item.mediaMensal)}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{formatCurrency(item.totalRapEmpenho)}</td>
                        {item.months.map((month) => {
                          const isExpiry = month.highlight;
                          return (
                            <td
                              key={`${item.id}-${month.label}`}
                              className="px-1.5 py-1 text-center text-[10px] font-semibold whitespace-nowrap align-middle"
                            >
                              {isExpiry ? (
                                <div
                                  className={`w-full min-w-[70px] h-full flex flex-col items-center justify-center gap-0.5 rounded-md border shadow-lg ${
                                    item.statusInfo.isExpired
                                      ? "border-rose-500 bg-gradient-to-br from-rose-700 via-rose-600 to-rose-500 text-white shadow-rose-500/40"
                                      : "border-amber-400 bg-gradient-to-br from-amber-200 via-amber-100 to-yellow-50 text-amber-900 shadow-amber-200/60"
                                  }`}
                                >
                                  <span className="text-[8px] uppercase tracking-wide font-black opacity-80">
                                    {item.expiry}
                                  </span>
                                  <span className="text-xs font-extrabold">
                                    {month.amount > 0 ? formatCurrency(month.amount) : formatCurrency(item.mediaMensal)}
                                  </span>
                                  <span
                                    className={`text-[8px] font-bold uppercase tracking-wide ${
                                      item.statusInfo.isExpired ? "opacity-95" : "opacity-80"
                                    }`}
                                  >
                                    {item.statusInfo.isExpired ? "Expirado" : "Vencendo"}
                                  </span>
                                </div>
                              ) : (
                                <div className={`relative flex items-center justify-center rounded ${monthStatusClass(month.status)} px-1 py-1`}>
                                  <span>{month.amount > 0 ? formatCurrencyCompact(month.amount) : "—"}</span>
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Charts Stack */}
        <div className="space-y-6">
          {/* Consumo Mensal */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-bold">Consumo Mensal 2025</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={filteredMonthlyData || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="Mês"
                    tick={{ fontSize: 12 }}
                    angle={-45}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    width={100}
                    tickFormatter={(value) => formatCurrency(value)}
                  />
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="Consumo_Mensal"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: "#3b82f6", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Distribuição por UGR - Pizza Melhorada */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-bold">Distribuição por UGR</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="Total_Anual_Estimado"
                    nameKey="displayName"
                    cx="50%"
                    cy="52%"
                    outerRadius={158}
                    innerRadius={88}
                    paddingAngle={2}
                    label={renderPieLabel}
                    labelLine={{
                      strokeWidth: 0.6,
                      stroke: '#94a3b8',
                      type: 'linear',
                      length: 20,
                      length2: 8,
                    }}
                    onClick={(entry: any) => window.location.href = `/ugr-details?ugr=${encodeURIComponent(entry.UGR)}`}
                  >
                    {(pieData || []).map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length] as string}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => formatCurrency(value)}
                    labelFormatter={(label: string) => `UGR: ${label}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          
        </div>

        {/* Taxa de Execução por UGR */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm font-bold">Taxa de Execução por UGR</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={filteredUgrData || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="UGR"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{ 
                    value: "Percentual de Execução (%)", 
                    angle: -90, 
                    position: "insideLeft",
                    offset: 10,
                    style: { fontSize: '14px' }
                  }}
                />
                <Tooltip 
                  formatter={(value: any) => `${value.toFixed(2)}%`}
                  contentStyle={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0" }}
                />
                <Bar
                  dataKey="Percentual_Execucao"
                  fill="#10b981"
                  radius={[8, 8, 0, 0]}
                  onClick={(entry: any) => window.location.href = `/ugr-details?ugr=${encodeURIComponent(entry.UGR)}`}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
