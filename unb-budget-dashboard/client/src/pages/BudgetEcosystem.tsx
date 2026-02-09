import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import UGRNetworkMotionChart from "@/components/UGRNetworkMotionChart";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function BudgetEcosystem() {
    const { data: ugrAnalysis, isLoading } = trpc.budget.getUGRAnalysis.useQuery();
    const [, setLocation] = useLocation();

    const handleNodeClick = (nodeData: any) => {
        // Navigate to details page
        if (nodeData && nodeData.UGR) {
            setLocation(`/ugr-details?ugr=${encodeURIComponent(nodeData.UGR)}`);
        }
    };

    return (
        <DashboardLayout>
            <div className="flex flex-col h-[calc(100vh-100px)] space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900">Ecossistema Orçamentário</h1>
                        <p className="text-slate-600 mt-1">
                            Visualização orgânica e interativa de todas as unidades da UnB.
                        </p>
                    </div>
                </div>

                <div className="flex-1 bg-slate-900 rounded-xl overflow-hidden shadow-2xl relative border border-slate-700">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full text-slate-400 animate-pulse">
                            Carregando o ecossistema...
                        </div>
                    ) : (
                        <div className="w-full h-full">
                            {/* Using the unified Motion Chart, forcing full size */}
                            <div className="h-full w-full [&>div]:!h-full [&>div]:!border-0 [&>div]:!rounded-none">
                                <UGRNetworkMotionChart
                                    data={ugrAnalysis || []}
                                    height={800}
                                    onNodeClick={handleNodeClick}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </DashboardLayout>
    );
}
