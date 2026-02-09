import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Clock, CheckCircle } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { DateDisplay } from "@/components/ui/date-display";
import { useState } from "react";

export default function Alerts() {
  const { data: expiringContracts, isLoading: expiringLoading } = trpc.budget.getExpiringContracts.useQuery();
  const { data: expiredContracts, isLoading: expiredLoading } = trpc.budget.getExpiredContracts.useQuery();
  const [expandedExpiring, setExpandedExpiring] = useState<number | null>(null);
  const [expandedExpired, setExpandedExpired] = useState<number | null>(null);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Alertas de Contratos</h1>
          <p className="text-slate-600 mt-1">Monitoramento de contratos expirados e a expirar</p>
        </div>

        {/* Contratos a Expirar */}
        <Card className="border-l-4 border-l-orange-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Contratos a Expirar (Próximos 90 Dias)
              </CardTitle>
              <span className="text-2xl font-bold text-orange-600">
                {expiringLoading ? "..." : expiringContracts?.length || 0}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {expiringLoading ? (
              <div className="text-center py-8 text-slate-500">Carregando contratos a expirar...</div>
            ) : expiringContracts && expiringContracts.length > 0 ? (
              <div className="space-y-3">
                {expiringContracts.map((contract: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 bg-orange-50 border border-orange-200 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => setExpandedExpiring(expandedExpiring === idx ? null : idx)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">{contract.Despesa}</h3>
                        <div className="grid grid-cols-2 gap-4 mt-2 text-sm text-slate-600">
                          <div>
                            <span className="font-medium">UGR:</span> {contract.UGR}
                          </div>
                          <DateDisplay date={contract.Data_Vigencia_Fim} label="Vigência" />
                        </div>
                      </div>
                      <div className="text-orange-600 font-semibold">⚠️ Atenção</div>
                    </div>
                    {expandedExpiring === idx && (
                      <div className="mt-4 pt-4 border-t border-orange-200 text-sm text-slate-600">
                        <div className="space-y-2">
                          <p><span className="font-medium">Status de Prorrogação:</span> {contract.Situacao_Prorrogacao || "Não informado"}</p>
                          <p className="text-orange-700 font-medium">Recomendação: Verifique o status de renovação/prorrogação deste contrato.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p>Nenhum contrato a expirar nos próximos 90 dias</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contratos Expirados */}
        <Card className="border-l-4 border-l-red-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Contratos Expirados - Ação Urgente
              </CardTitle>
              <span className="text-2xl font-bold text-red-600">
                {expiredLoading ? "..." : expiredContracts?.length || 0}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {expiredLoading ? (
              <div className="text-center py-8 text-slate-500">Carregando contratos expirados...</div>
            ) : expiredContracts && expiredContracts.length > 0 ? (
              <div className="space-y-3">
                {expiredContracts.map((contract: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 bg-red-50 border border-red-200 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => setExpandedExpired(expandedExpired === idx ? null : idx)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">{contract.Despesa}</h3>
                        <div className="grid grid-cols-2 gap-4 mt-2 text-sm text-slate-600">
                          <div>
                            <span className="font-medium">UGR:</span> {contract.UGR}
                          </div>
                          <DateDisplay date={contract.Data_Vigencia_Fim} label="Vigência" />
                        </div>
                      </div>
                      <div className="text-red-600 font-semibold">🔴 EXPIRADO</div>
                    </div>
                    {expandedExpired === idx && (
                      <div className="mt-4 pt-4 border-t border-red-200 text-sm text-slate-600">
                        <div className="space-y-2">
                          <p><span className="font-medium">Status de Prorrogação:</span> {contract.Situacao_Prorrogacao || "Não informado"}</p>
                          <p className="text-red-700 font-bold">⚠️ URGENTE: Este contrato expirou e requer ação imediata. Verifique se há processo de renovação em andamento.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-500">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                <p>Nenhum contrato expirado</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resumo de Ações */}
        <Card className="bg-blue-50 border border-blue-200">
          <CardHeader>
            <CardTitle>Resumo de Ações Recomendadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="text-blue-600 font-bold">1.</div>
                <div>
                  <p className="font-semibold text-slate-900">Revisar Contratos Expirados</p>
                  <p className="text-slate-600">Verifique imediatamente os contratos expirados e inicie processos de renovação se necessário.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="text-blue-600 font-bold">2.</div>
                <div>
                  <p className="font-semibold text-slate-900">Monitorar Contratos a Expirar</p>
                  <p className="text-slate-600">Acompanhe os contratos que expiram nos próximos 90 dias e prepare a documentação para renovação.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="text-blue-600 font-bold">3.</div>
                <div>
                  <p className="font-semibold text-slate-900">Comunicar aos Responsáveis</p>
                  <p className="text-slate-600">Notifique as UGRs responsáveis sobre os prazos de renovação e ações necessárias.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

