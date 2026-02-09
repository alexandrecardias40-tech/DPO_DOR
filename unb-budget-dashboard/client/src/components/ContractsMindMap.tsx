
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

interface ContractMindMapProps {
    contracts: any[];
    ugrName: string;
}

export function ContractsMindMap({ contracts, ugrName }: ContractMindMapProps) {
    const [selectedContract, setSelectedContract] = useState<any | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const graphRef = useRef<any>();

    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.offsetWidth,
                    height: containerRef.current.offsetHeight
                });
            }
        };

        window.addEventListener('resize', updateDimensions);
        // Initial delay to allow modal to render
        setTimeout(updateDimensions, 100);

        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // Process Data for Graph
    const graphData = useMemo(() => {
        const nodes: any[] = [];
        const links: any[] = [];

        // Central Hub
        nodes.push({
            id: 'hub',
            name: ugrName,
            val: 50, // Base size
            color: '#2563eb', // Blue-600
            isHub: true
        });

        const sortedContracts = contracts.sort((a, b) => b.Total_Anual_Estimado - a.Total_Anual_Estimado);

        sortedContracts.forEach((contract, index) => {
            const today = new Date();
            const vigenciaFim = contract.Data_Vigencia_Fim ? new Date(contract.Data_Vigencia_Fim) : null;

            let statusColor = "#94a3b8"; // slate-400
            if (vigenciaFim) {
                const daysLeft = (vigenciaFim.getTime() - today.getTime()) / (1000 * 3600 * 24);
                if (daysLeft < 0) statusColor = "#ef4444"; // red-500
                else if (daysLeft < 90) statusColor = "#f59e0b"; // amber-500
                else statusColor = "#10b981"; // emerald-500
            }

            // Scale size log or sqrt to avoid massive nodes
            const size = Math.max(5, Math.log(contract.Total_Anual_Estimado || 1) * 2);

            const nodeId = `contract-${index}`;
            nodes.push({
                id: nodeId,
                name: contract.Despesa,
                val: size,
                color: statusColor,
                contractData: contract,
                isHub: false
            });

            links.push({
                source: 'hub',
                target: nodeId,
                color: 'rgba(203, 213, 225, 0.4)' // slate-300 with opacity
            });
        });

        return { nodes, links };
    }, [contracts, ugrName]);

    const handleNodeClick = useCallback((node: any) => {
        if (node.isHub) {
            setSelectedContract(null);
            // Optional: Reset zoom
            graphRef.current?.zoomToFit(400);
        } else {
            setSelectedContract(node.contractData);
            // Optional: Center on node?
            // graphRef.current?.centerAt(node.x, node.y, 400);
            // graphRef.current?.zoom(2, 2000);
        }
    }, [graphRef]);

    return (
        <div className="relative w-full h-full bg-slate-950 flex overflow-hidden">
            {/* Graph Container */}
            <div ref={containerRef} className="flex-1 w-full h-full">
                <ForceGraph2D
                    ref={graphRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    graphData={graphData}
                    nodeLabel="name"
                    nodeColor="color"
                    nodeRelSize={6}
                    linkColor="color"
                    linkWidth={1}
                    onNodeClick={handleNodeClick}
                    backgroundColor="#020617" // slate-950
                    d3AlphaDecay={0.02} // Slower decay for more movement initially
                    d3VelocityDecay={0.08} // Lower friction
                    cooldownTicks={100}
                    onEngineStop={() => graphRef.current?.zoomToFit(400, 50)}
                />
            </div>

            {/* Details Overlay Panel */}
            <AnimatePresence>
                {selectedContract && (
                    <motion.div
                        initial={{ x: 400, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: 400, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="absolute right-0 top-0 h-full w-[400px] max-w-full bg-white/95 backdrop-blur shadow-2xl border-l border-slate-200 z-50 overflow-y-auto"
                    >
                        <div className="p-4 flex justify-between items-center border-b border-slate-100">
                            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Detalhes do Contrato</h2>
                            <button
                                onClick={() => setSelectedContract(null)}
                                className="p-1 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div>
                                <h3 className="text-xl font-extrabold text-slate-900 leading-tight mb-2">{selectedContract.Despesa}</h3>
                                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                                    {selectedContract.UGR === ugrName ? 'Contrato Local' : `UGR: ${selectedContract.UGR}`}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Valor Anual Estimado</p>
                                    <p className="text-2xl font-bold text-slate-800">{formatCurrency(selectedContract.Total_Anual_Estimado || 0)}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Empenhado + RAP</p>
                                        <p className="text-sm font-bold text-blue-700">{formatCurrency(selectedContract.Total_Empenho_RAP || 0)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Execução</p>
                                        <p className="text-sm font-bold text-slate-700">
                                            {selectedContract.Total_Anual_Estimado > 0
                                                ? ((selectedContract.Total_Empenho_RAP / selectedContract.Total_Anual_Estimado) * 100).toFixed(1) + '%'
                                                : '0%'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Status e Vigência</h4>

                                {(() => {
                                    const today = new Date();
                                    const fim = selectedContract.Data_Vigencia_Fim ? new Date(selectedContract.Data_Vigencia_Fim) : null;
                                    if (!fim) return <p className="text-sm text-slate-500 italic">Vigência não informada.</p>;

                                    const days = (fim.getTime() - today.getTime()) / (1000 * 3600 * 24);
                                    let status = { label: "Vigente", color: "bg-emerald-100 text-emerald-700 border-emerald-200" };
                                    if (days < 0) status = { label: "Vencido", color: "bg-red-100 text-red-700 border-red-200" };
                                    else if (days < 90) status = { label: "Vence em breve", color: "bg-amber-100 text-amber-700 border-amber-200" };

                                    return (
                                        <div className="space-y-3">
                                            <div className={`inline-flex px-3 py-1 rounded-full text-xs font-bold border ${status.color}`}>
                                                {status.label}
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-500">Término da Vigência:</span>
                                                <span className="font-medium text-slate-900">{fim.toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-500">Dias Restantes:</span>
                                                <span className={`font-bold ${days < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                                                    {Math.floor(days)} dias
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Legend/Controls Overlay */}
            <div className="absolute bottom-4 left-4 p-4 bg-slate-900/80 backdrop-blur rounded-xl border border-slate-700/50 text-slate-300 text-xs space-y-2 pointer-events-none">
                <div className="font-bold text-white mb-1">Legenda</div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                    <span>Vigente (&gt; 90 dias)</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <span>Vencendo (Próx. 90 dias)</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span>Vencido</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-400">
                    Clique, arraste e use o scroll para navegar.
                </div>
            </div>
        </div>
    );
}
