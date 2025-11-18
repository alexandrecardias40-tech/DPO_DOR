import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

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

  const [selectedPi, setSelectedPi] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const hasActiveFilters = Boolean(selectedPi);
  const piOptions = useMemo(() => {
    if (!allData) return [];
    const options = new Set(allData.map((item: any) => item.PI_2025).filter(Boolean));
    return Array.from(options).sort();
  }, [allData]);

  // Filter data based on active filters
  const filteredData = useMemo(() => {
    if (!allData) return [];
    return allData.filter((item: any) => {
      if (selectedPi && item.PI_2025 !== selectedPi) return false;
      return true;
    });
  }, [allData, selectedPi]);

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

  const contractTimeline = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();

    return filteredData.map((item: any, index: number) => {
      const pi = item.PI_2025 || "—";
      const descricao =
        item["Descrição das despesas"] ||
        item.descricao ||
        item.Despesa ||
        "—";
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
        descricao,
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
  if (status === "ok") return "bg-emerald-50 border-emerald-200 text-emerald-700";
  if (status === "partial") return "bg-amber-50 border-amber-200 text-amber-800";
  return "bg-rose-50 border-rose-200 text-rose-700";
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
              <div className="flex flex-wrap items-end gap-3 text-xs text-slate-600">
                <label className="flex flex-col gap-1 font-semibold text-slate-700">
                  Plano Interno (PI)
                  <select
                    value={selectedPi}
                    onChange={(e) => setSelectedPi(e.target.value)}
                    className="w-48 text-xs border border-slate-300 rounded-md bg-white px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Selecione um PI...</option>
                    {piOptions.map((pi) => (
                      <option key={pi} value={pi}>
                        {pi}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 font-semibold text-slate-700">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="w-48 text-xs border border-slate-300 rounded-md bg-white px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STATUS_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {hasActiveFilters && (
                  <Button
                    onClick={() => {
                      setSelectedPi("");
                    }}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    <X className="w-3 h-3 mr-1" />
                    Limpar filtros
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <table className="w-full table-fixed border-collapse text-[11px] md:text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 text-left w-[34%]">Descrição das Despesas</th>
                    <th className="px-2 py-2 text-center w-[10%]">Valor Contrato</th>
                    <th className="px-2 py-2 text-center w-[10%]">Média Mensal</th>
                    <th className="px-2 py-2 text-center w-[12%]">Total RAP+Empenho</th>
                    <th className="px-2 py-2 text-left w-[34%]">Cronograma (Jan–Dez)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimeline.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-center text-xs text-slate-500">
                        Nenhum contrato com esse status.
                      </td>
                    </tr>
                  ) : (
                    filteredTimeline.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 text-slate-900 align-top">
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1 text-[11px] leading-snug">
                            <span className="font-semibold text-slate-900 line-clamp-2">{item.descricao}</span>
                            {item.contrato && <span className="text-[10px] text-slate-500">{item.contrato}</span>}
                            <span className="text-[10px] text-slate-500">PI: {item.pi}</span>
                            <div
                              className={`inline-flex flex-col items-start gap-0.5 rounded-md px-2.5 py-2 border text-[10px] font-semibold ${item.statusInfo.badgeClass}`}
                            >
                              <span className="uppercase tracking-wide">{item.statusInfo.label}</span>
                              {item.statusInfo.detail && (
                                <span className="text-[9px] font-normal opacity-80">{item.statusInfo.detail}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center whitespace-nowrap">
                          <div className="text-xs font-semibold text-slate-400 mb-1">Valor Contrato</div>
                          <div className="text-sm font-bold text-slate-900">{formatCurrency(item.valorContrato)}</div>
                        </td>
                        <td className="px-2 py-3 text-center whitespace-nowrap">
                          <div className="text-xs font-semibold text-slate-400 mb-1">Média Mensal</div>
                          <div className="text-sm font-bold text-slate-900">{formatCurrency(item.mediaMensal)}</div>
                        </td>
                        <td className="px-2 py-3 text-center whitespace-nowrap">
                          <div className="text-xs font-semibold text-slate-400 mb-1">Total RAP+Empenho</div>
                          <div className="text-sm font-bold text-slate-900">{formatCurrency(item.totalRapEmpenho)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="grid grid-cols-6 gap-1">
                            {item.months.map((month) => {
                              const isExpiry = month.highlight;
                              if (isExpiry) {
                                return (
                                  <div
                                    key={`${item.id}-${month.label}`}
                                    className={`col-span-2 flex flex-col items-center justify-center rounded-lg border px-2 py-2 text-center shadow ${
                                      item.statusInfo.isExpired
                                        ? "border-rose-500 bg-gradient-to-br from-rose-700 via-rose-600 to-rose-500 text-white shadow-rose-400/50"
                                        : "border-amber-400 bg-gradient-to-br from-amber-200 via-amber-100 to-yellow-50 text-amber-900 shadow-amber-200/60"
                                    }`}
                                  >
                                    <span className="text-[8px] uppercase tracking-wide font-black opacity-80 leading-3">
                                      {month.label}
                                    </span>
                                    <span className="text-[11px] font-extrabold leading-4">
                                      {month.amount > 0 ? formatCurrency(month.amount) : formatCurrency(item.mediaMensal)}
                                    </span>
                                    <span className="text-[8px] font-bold uppercase tracking-wide opacity-90 leading-3">
                                      {item.statusInfo.isExpired ? "Expirado" : "Vencendo"}
                                    </span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={`${item.id}-${month.label}`}
                                  className={`flex flex-col items-center justify-center rounded-md border px-1.5 py-2 text-[9px] font-semibold text-center ${monthStatusClass(
                                    month.status
                                  )}`}
                                >
                                  <span className="uppercase text-[7px] tracking-wide leading-3">{month.label}</span>
                                  <span className="text-[9px] font-semibold leading-4">
                                    {month.amount > 0 ? formatCurrencyCompact(month.amount) : "—"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

      </div>
    </DashboardLayout>
  );
}
