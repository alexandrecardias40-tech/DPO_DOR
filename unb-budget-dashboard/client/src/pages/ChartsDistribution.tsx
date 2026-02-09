import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import DashboardLayout from "@/components/DashboardLayout";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { AnimatedGraph } from "@/components/charts/AnimatedGraph";

// Dynamic import for ForceGraph3D to avoid SSR issues
let ForceGraph3D: any = null;

interface GraphNode {
  id: string;
  name: string;
  val: number;
  color: string;
  group: number;
  budget: number;
  committed: number;
  executed: number;
  contracts: number;
  activeContracts: number;
  expiredContracts: number;
  category: string;
  commitmentRatio: number;
  contractActivity: number;
  executionPercent?: number;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
  type: 'budget' | 'execution' | 'collaboration';
}

export default function ChartsDistribution() {
  console.log('ChartsDistribution component rendering');
  const { data: ugrAnalysis, isLoading: ugrLoading } = trpc.budget.getUGRAnalysis.useQuery();
  const [, setLocation] = useLocation();
  const [graphRef, setGraphRef] = useState<any>(null);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedNodeForModal, setSelectedNodeForModal] = useState<GraphNode | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Load ForceGraph3D dynamically
  useEffect(() => {
    if (typeof window !== 'undefined' && !ForceGraph3D) {
      console.log('Loading ForceGraph3D...');
      import('react-force-graph-3d').then(module => {
        console.log('ForceGraph3D loaded successfully');
        ForceGraph3D = module.default;
        console.log('ForceGraph3D component:', ForceGraph3D);
        setGraphLoaded(true);
      }).catch(error => {
        console.error('Failed to load ForceGraph3D:', error);
        setGraphLoaded(true); // Still set to true to show error message
      });
    } else {
      console.log('ForceGraph3D already loaded or SSR');
      setGraphLoaded(true);
    }
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  // Função para criar textura de texto para os nós
  const createTextTexture = useCallback((text: string) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 256;
    canvas.height = 64;

    // Fundo transparente
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Configurar texto
    context.font = 'bold 14px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Adicionar sombra para melhor legibilidade
    context.shadowColor = 'black';
    context.shadowBlur = 2;
    context.shadowOffsetX = 1;
    context.shadowOffsetY = 1;

    // Desenhar texto
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    return canvas;
  }, []);

  // Generate graph data from real UGR analysis data
  const graphData = useMemo(() => {
    console.log('Creating graph data from real UGR analysis');

    if (!ugrAnalysis || ugrAnalysis.length === 0) {
      // Fallback to functional test data if no real data
      const nodes = [
        { id: 'UGR001', name: 'Unidade 1', val: 15, color: '#ff6b6b', budget: 1000000, committed: 500000, executed: 300000, contracts: 5, activeContracts: 4, expiredContracts: 1, category: 'Pequeno', commitmentRatio: 50, contractActivity: 5 },
        { id: 'UGR002', name: 'Unidade 2', val: 20, color: '#4ecdc4', budget: 2000000, committed: 800000, executed: 600000, contracts: 8, activeContracts: 7, expiredContracts: 1, category: 'Médio', commitmentRatio: 40, contractActivity: 8 },
        { id: 'UGR003', name: 'Unidade 3', val: 25, color: '#45b7d1', budget: 3000000, committed: 1200000, executed: 900000, contracts: 12, activeContracts: 10, expiredContracts: 2, category: 'Grande', commitmentRatio: 40, contractActivity: 12 },
        { id: 'UGR004', name: 'Unidade 4', val: 18, color: '#f9ca24', budget: 1500000, committed: 600000, executed: 450000, contracts: 6, activeContracts: 5, expiredContracts: 1, category: 'Médio', commitmentRatio: 40, contractActivity: 6 },
        { id: 'UGR005', name: 'Unidade 5', val: 22, color: '#f0932b', budget: 2500000, committed: 1000000, executed: 750000, contracts: 10, activeContracts: 8, expiredContracts: 2, category: 'Grande', commitmentRatio: 40, contractActivity: 10 },
        { id: 'UGR006', name: 'Unidade 6', val: 16, color: '#eb4d4b', budget: 1200000, committed: 480000, executed: 360000, contracts: 4, activeContracts: 3, expiredContracts: 1, category: 'Pequeno', commitmentRatio: 40, contractActivity: 4 },
        { id: 'UGR007', name: 'Unidade 7', val: 19, color: '#6c5ce7', budget: 1800000, committed: 720000, executed: 540000, contracts: 7, activeContracts: 6, expiredContracts: 1, category: 'Médio', commitmentRatio: 40, contractActivity: 7 },
        { id: 'UGR008', name: 'Unidade 8', val: 21, color: '#a29bfe', budget: 2200000, committed: 880000, executed: 660000, contracts: 9, activeContracts: 7, expiredContracts: 2, category: 'Grande', commitmentRatio: 40, contractActivity: 9 }
      ];
      const links = [
        { source: 'UGR001', target: 'UGR002', value: 1, type: 'budget' },
        { source: 'UGR002', target: 'UGR003', value: 1.5, type: 'execution' },
        { source: 'UGR003', target: 'UGR004', value: 1, type: 'collaboration' },
        { source: 'UGR004', target: 'UGR005', value: 0.8, type: 'budget' },
        { source: 'UGR005', target: 'UGR006', value: 1.2, type: 'execution' },
        { source: 'UGR006', target: 'UGR007', value: 1, type: 'collaboration' },
        { source: 'UGR007', target: 'UGR008', value: 1.3, type: 'budget' },
        { source: 'UGR001', target: 'UGR003', value: 0.7, type: 'collaboration' },
        { source: 'UGR002', target: 'UGR004', value: 0.9, type: 'execution' },
        { source: 'UGR003', target: 'UGR005', value: 1.1, type: 'budget' },
        { source: 'UGR004', target: 'UGR006', value: 0.8, type: 'collaboration' },
        { source: 'UGR005', target: 'UGR007', value: 1.4, type: 'execution' },
        { source: 'UGR006', target: 'UGR008', value: 1.2, type: 'budget' }
      ];
      return { nodes, links };
    }

    // Create nodes from real UGR data
    const nodes = ugrAnalysis.map((ugr: any, index: number) => {
      const budget = ugr.Total_Anual_Estimado || 0;
      const executed = ugr.Total_Empenho_RAP || 0;
      const committed = ugr.Saldo_Empenhos_RAP || 0;
      const contracts = (ugr.Contratos_Ativos || 0) + (ugr.Contratos_Expirados || 0);
      const activeContracts = ugr.Contratos_Ativos || 0;
      const expiredContracts = ugr.Contratos_Expirados || 0;
      const executionPercent = ugr.Percentual_Execucao || 0;

      // Calculate node size based on budget (normalized)
      const maxBudget = Math.max(...ugrAnalysis.map((u: any) => u.Total_Anual_Estimado || 0));
      const minBudget = Math.min(...ugrAnalysis.map((u: any) => u.Total_Anual_Estimado || 0));
      const normalizedBudget = maxBudget > minBudget ? (budget - minBudget) / (maxBudget - minBudget) : 0.5;
      const nodeSize = Math.max(8, Math.min(35, 8 + normalizedBudget * 27)); // Size between 8-35

      // Color based on execution percentage and budget size
      let color = '#94a3b8'; // Default gray
      if (executionPercent >= 80) {
        color = budget > 10000000 ? '#10b981' : budget > 5000000 ? '#34d399' : '#6ee7b7'; // Green shades
      } else if (executionPercent >= 50) {
        color = budget > 10000000 ? '#f59e0b' : budget > 5000000 ? '#fbbf24' : '#fcd34d'; // Yellow shades
      } else {
        color = budget > 10000000 ? '#ef4444' : budget > 5000000 ? '#f87171' : '#fca5a5'; // Red shades
      }

      // Category based on budget size
      let category = 'Pequeno';
      if (budget > 10000000) category = 'Muito Grande';
      else if (budget > 5000000) category = 'Grande';
      else if (budget > 1000000) category = 'Médio';

      // Commitment ratio (executed / budget)
      const commitmentRatio = budget > 0 ? (executed / budget) * 100 : 0;

      return {
        id: `UGR${index + 1}`,
        name: ugr.UGR || `UGR ${index + 1}`,
        val: nodeSize,
        color,
        budget,
        committed,
        executed,
        contracts,
        activeContracts,
        expiredContracts,
        category,
        commitmentRatio,
        contractActivity: contracts,
        executionPercent
      };
    });

    // Create links based on budget similarity and execution patterns
    const links = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];

        // Calculate similarity score based on budget and execution
        const budgetDiff = Math.abs(nodeA.budget - nodeB.budget);
        const maxBudget = Math.max(nodeA.budget, nodeB.budget);
        const budgetSimilarity = maxBudget > 0 ? 1 - (budgetDiff / maxBudget) : 0;

        const executionDiff = Math.abs(nodeA.executionPercent - nodeB.executionPercent);
        const executionSimilarity = 1 - (executionDiff / 100);

        const similarity = (budgetSimilarity + executionSimilarity) / 2;

        // Only create links for similar UGRs (similarity > 0.3)
        if (similarity > 0.3) {
          const linkStrength = Math.max(0.5, similarity * 2);
          const linkType = budgetSimilarity > executionSimilarity ? 'budget' : 'execution';

          links.push({
            source: nodeA.id,
            target: nodeB.id,
            value: linkStrength,
            type: linkType
          });
        }
      }
    }

    // Limit links to top 50 most similar connections
    links.sort((a, b) => b.value - a.value);
    const topLinks = links.slice(0, Math.min(50, links.length));

    console.log('Real data graph created:', {
      nodes: nodes.length,
      links: topLinks.length,
      totalBudget: nodes.reduce((sum: number, node: any) => sum + node.budget, 0),
      avgExecution: nodes.reduce((sum: number, node: any) => sum + node.executionPercent, 0) / nodes.length
    });

    return { nodes, links: topLinks };
  }, [ugrAnalysis]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNodeForModal(node);
    setDetailsModalOpen(true);

    // Centralizar o grafo no nó clicado
    if (graphRef) {
      graphRef.cameraPosition(
        { x: 0, y: 0, z: 300 }, // posição da câmera
        node, // nó para focar
        2000 // tempo da transição em ms
      );
    }
  }, [graphRef]);

  if (ugrLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Distribuição por UGR</h1>
            <p className="text-slate-600 mt-1">Análise da distribuição orçamentária entre as unidades gestoras</p>
          </div>
          <div className="h-96 flex items-center justify-center text-slate-500">
            Carregando grafo 3D...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Distribuição por UGR</h1>
          <p className="text-slate-600 mt-1">Análise interativa 3D da distribuição orçamentária entre as unidades gestoras</p>
        </div>

        {/* 3D Graph */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Grafo 3D de Distribuição Orçamentária</CardTitle>
            <p className="text-sm text-slate-600">
              Explore a rede interativa de UGRs. O tamanho das bolas representa o orçamento total, e as conexões mostram relacionamentos por similaridade de orçamento e comprometimento. Clique em qualquer nó para centralizar a visualização e ver detalhes completos. Arraste para mover a visualização.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="text-xs">
                🖱️ Clique: Centralizar nó
              </Badge>
              <Badge variant="outline" className="text-xs">
                🖱️ Arraste: Mover visualização
              </Badge>
              <Badge variant="outline" className="text-xs">
                🔄 Roda: Zoom
              </Badge>
              <Badge variant="outline" className="text-xs">
                🎯 Fundo: Reset câmera
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div className="h-[600px] w-full border rounded-lg overflow-hidden bg-slate-50">
                {!graphLoaded ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    Carregando grafo 3D...
                  </div>
                ) : ForceGraph3D ? (
                  (() => {
                    console.log('Rendering ForceGraph3D with data:', graphData);
                    console.log('ForceGraph3D component available:', !!ForceGraph3D);
                    return (
                      <ForceGraph3D
                        ref={setGraphRef}
                        graphData={graphData}
                        nodeLabel={(node: any) => `${node.name}\n💰 Orçamento: ${formatCurrency(node.budget)}\n� Comprometido: ${formatCurrency(node.committed)}\n✅ Executado: ${formatCurrency(node.executed)}\n📋 Contratos: ${node.contracts} (${node.activeContracts} ativos)\n🏷️ Categoria: ${node.category}\n\nClique para centralizar e ver detalhes`}
                        nodeColor={(node: any) => node.color}
                        nodeVal={(node: any) => node.val}
                        linkColor={(link: any) => {
                          switch (link.type) {
                            case 'budget': return '#3b82f6';
                            case 'execution': return '#10b981';
                            case 'collaboration': return '#f59e0b';
                            default: return '#94a3b8';
                          }
                        }}
                        linkWidth={(link: any) => link.value * 2}
                        linkOpacity={0.6}
                        backgroundColor="#0f172a"
                        onNodeClick={handleNodeClick}
                        enableNodeDrag={false}
                        enableNavigationControls={true}
                        controlType="orbit"
                        showNavInfo={true}
                        nodeResolution={20}
                        linkResolution={8}
                        cooldownTicks={150}
                        d3AlphaDecay={0.01}
                        d3VelocityDecay={0.2}
                        d3Force='charge'
                        onBackgroundClick={() => {
                          // Reset camera position when clicking background
                          if (graphRef) {
                            graphRef.cameraPosition(
                              { x: 0, y: 0, z: 500 },
                              null,
                              1000
                            );
                          }
                        }}
                      />
                    );
                  })()
                ) : (
                  <div className="h-full flex items-center justify-center text-red-500">
                    Erro ao carregar grafo 3D
                  </div>
                )}
              </div>

              {/* Enhanced Legend */}
              <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-sm rounded-lg p-4 shadow-xl max-w-sm border border-slate-700">
                <h4 className="font-bold text-white mb-3 text-sm">🎯 Análise Visual Inteligente</h4>
                <div className="space-y-3 text-xs">
                  <div className="space-y-2">
                    <div className="text-slate-300 font-medium mb-2">📊 Tamanho do Nó = Orçamento Total</div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-green-400 to-green-600 border border-white"></div>
                      <span className="text-white">Execução Alta (&gt;80%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600 border border-white"></div>
                      <span className="text-white">Execução Média (50-80%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gradient-to-r from-red-400 to-red-600 border border-white"></div>
                      <span className="text-white">Execução Baixa (&lt;50%)</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-600 pt-3">
                    <div className="text-slate-300 font-medium mb-2">🔗 Conexões por Similaridade:</div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-0.5 bg-blue-400"></div>
                        <span className="text-slate-300">Orçamento Similar</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-0.5 bg-green-400"></div>
                        <span className="text-slate-300">Padrão de Execução</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-600 pt-3">
                    <div className="text-slate-300 font-medium mb-2">📈 Estatísticas em Tempo Real:</div>
                    <div className="space-y-1 text-slate-400">
                      <div>Total UGRs: <span className="text-white font-semibold">{graphData.nodes.length}</span></div>
                      <div>Orçamento Total: <span className="text-green-400 font-semibold">
                        {formatCurrency(graphData.nodes.reduce((sum: number, node: any) => sum + node.budget, 0))}
                      </span></div>
                      <div>Média Execução: <span className="text-blue-400 font-semibold">
                        {formatPercent(graphData.nodes.reduce((sum: number, node: any) => sum + (node.executionPercent || 0), 0) / graphData.nodes.length)}
                      </span></div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </CardContent>
        </Card>

        {/* New 2D Ecosystem Graph */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Ecossistema Orçamentário (Visualização Alternativa)</CardTitle>
            <p className="text-sm text-slate-600">
              Uma visão unificada e orgânica das UGRs. Arraste o fundo para explorar o ecossistema.
            </p>
          </CardHeader>
          <CardContent>
            {ugrAnalysis && ugrAnalysis.length > 0 ? (
              <AnimatedGraph data={ugrAnalysis} />
            ) : (
              <div className="h-96 flex items-center justify-center text-slate-500">
                Carregando dados...
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detailed Table */}
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Detalhes por UGR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-900">UGR</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-900">Orçamento Total</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-900">% do Total</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-900">Já Executado</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-900">% Execução</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-900">Contratos</th>
                    <th className="px-4 py-3 text-center font-semibold text-slate-900">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(ugrAnalysis || [])
                    .sort((a: any, b: any) => b.Total_Anual_Estimado - a.Total_Anual_Estimado)
                    .map((ugr: any, idx: number) => {
                      const totalBudget = (ugrAnalysis || []).reduce((sum: number, u: any) => sum + u.Total_Anual_Estimado, 0);
                      const percentOfTotal = (ugr.Total_Anual_Estimado / totalBudget) * 100;
                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium text-slate-900">{ugr.UGR}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Anual_Estimado)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-blue-600">{formatPercent(percentOfTotal)}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(ugr.Total_Empenho_RAP)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${ugr.Percentual_Execucao > 50 ? 'text-green-600' : 'text-orange-600'
                              }`}>
                              {formatPercent(ugr.Percentual_Execucao)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block bg-slate-200 text-slate-900 rounded-full px-3 py-1 text-xs font-semibold">
                              {ugr.Contratos_Ativos + ugr.Contratos_Expirados}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setLocation(`/ugr-details?ugr=${encodeURIComponent(ugr.UGR)}`)}
                            >
                              Ver Detalhes
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Top 5 UGRs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top 5 por Orçamento */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Top 5 - Maior Orçamento</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(ugrAnalysis || [])
                  .sort((a: any, b: any) => b.Total_Anual_Estimado - a.Total_Anual_Estimado)
                  .slice(0, 5)
                  .map((ugr: any, idx: number) => (
                    <div key={idx} className="p-3 bg-blue-50 rounded border border-blue-200 hover:bg-blue-100 transition-colors cursor-pointer" onClick={() => setLocation(`/ugr-details?ugr=${encodeURIComponent(ugr.UGR)}`)}>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">{idx + 1}. {ugr.UGR}</div>
                        <div className="text-right">
                          <div className="font-bold text-blue-600">{formatCurrency(ugr.Total_Anual_Estimado)}</div>
                          <div className="text-xs text-slate-600">Orçamento</div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Top 5 por Execução */}
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-lg font-bold text-slate-900">Top 5 - Maior Execução %</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(ugrAnalysis || [])
                  .sort((a: any, b: any) => b.Percentual_Execucao - a.Percentual_Execucao)
                  .slice(0, 5)
                  .map((ugr: any, idx: number) => (
                    <div key={idx} className="p-3 bg-green-50 rounded border border-green-200 hover:bg-green-100 transition-colors cursor-pointer" onClick={() => setLocation(`/ugr-details?ugr=${encodeURIComponent(ugr.UGR)}`)}>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">{idx + 1}. {ugr.UGR}</div>
                        <div className="text-right">
                          <div className="font-bold text-green-600">{formatPercent(ugr.Percentual_Execucao)}</div>
                          <div className="text-xs text-slate-600">Execução</div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Details Modal */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-slate-900 flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full ${selectedNodeForModal?.color || 'bg-slate-400'}`}></div>
              Detalhes da UGR: {selectedNodeForModal?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedNodeForModal && (
            <div className="space-y-6">
              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border-blue-200 bg-blue-50">
                  <CardContent className="p-4">
                    <div className="text-sm text-blue-600 font-medium">Orçamento Total</div>
                    <div className="text-2xl font-bold text-blue-900">{formatCurrency(selectedNodeForModal.budget)}</div>
                  </CardContent>
                </Card>

                <Card className="border-green-200 bg-green-50">
                  <CardContent className="p-4">
                    <div className="text-sm text-green-600 font-medium">Valor Comprometido</div>
                    <div className="text-2xl font-bold text-green-900">{formatCurrency(selectedNodeForModal.committed)}</div>
                  </CardContent>
                </Card>

                <Card className="border-purple-200 bg-purple-50">
                  <CardContent className="p-4">
                    <div className="text-sm text-purple-600 font-medium">Valor Executado</div>
                    <div className="text-2xl font-bold text-purple-900">{formatCurrency(selectedNodeForModal.executed)}</div>
                  </CardContent>
                </Card>

                <Card className="border-orange-200 bg-orange-50">
                  <CardContent className="p-4">
                    <div className="text-sm text-orange-600 font-medium">Contratos Totais</div>
                    <div className="text-2xl font-bold text-orange-900">{selectedNodeForModal.contracts}</div>
                    <div className="text-xs text-orange-600">{selectedNodeForModal.activeContracts} ativos</div>
                  </CardContent>
                </Card>
              </div>

              {/* Advanced Indicators */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold text-slate-900">Indicadores Avançados</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-slate-600">Taxa de Comprometimento</span>
                          <Badge variant={selectedNodeForModal.commitmentRatio > 80 ? "default" : selectedNodeForModal.commitmentRatio > 50 ? "secondary" : "destructive"}>
                            {selectedNodeForModal.commitmentRatio > 80 ? "Alta" : selectedNodeForModal.commitmentRatio > 50 ? "Média" : "Baixa"}
                          </Badge>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${selectedNodeForModal.commitmentRatio > 80 ? 'bg-green-500' :
                              selectedNodeForModal.commitmentRatio > 50 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                            style={{ width: `${Math.min(selectedNodeForModal.commitmentRatio, 100)}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{formatPercent(selectedNodeForModal.commitmentRatio)}</div>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-slate-600">Atividade Contratual</span>
                          <Badge variant={selectedNodeForModal.contractActivity > 5 ? "default" : selectedNodeForModal.contractActivity > 2 ? "secondary" : "destructive"}>
                            {selectedNodeForModal.contractActivity > 5 ? "Alta" : selectedNodeForModal.contractActivity > 2 ? "Média" : "Baixa"}
                          </Badge>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${selectedNodeForModal.contractActivity > 5 ? 'bg-green-500' :
                              selectedNodeForModal.contractActivity > 2 ? 'bg-yellow-500' : 'bg-red-500'
                              }`}
                            style={{ width: `${Math.min((selectedNodeForModal.contractActivity / 10) * 100, 100)}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{selectedNodeForModal.contractActivity} contratos</div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-lg">
                        <h4 className="font-semibold text-slate-900 mb-2">Status de Risco</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>Comprometimento Excessivo:</span>
                            <span className={`font-semibold ${selectedNodeForModal.commitmentRatio > 90 ? 'text-red-600' :
                              selectedNodeForModal.commitmentRatio > 70 ? 'text-orange-600' : 'text-green-600'
                              }`}>
                              {selectedNodeForModal.commitmentRatio > 90 ? 'Alto' :
                                selectedNodeForModal.commitmentRatio > 70 ? 'Médio' : 'Baixo'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Atividade Contratual:</span>
                            <span className={`font-semibold ${selectedNodeForModal.contractActivity > 5 ? 'text-green-600' :
                              selectedNodeForModal.contractActivity > 2 ? 'text-yellow-600' : 'text-red-600'
                              }`}>
                              {selectedNodeForModal.contractActivity > 5 ? 'Alta' :
                                selectedNodeForModal.contractActivity > 2 ? 'Média' : 'Baixa'}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Contratos Expirados:</span>
                            <span className={`font-semibold ${selectedNodeForModal.expiredContracts > 0 ? 'text-red-600' : 'text-green-600'
                              }`}>
                              {selectedNodeForModal.expiredContracts > 0 ? `${selectedNodeForModal.expiredContracts} expirados` : 'Nenhum'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                <Button
                  onClick={() => {
                    setLocation(`/ugr-details?ugr=${encodeURIComponent(selectedNodeForModal.name)}`);
                    setDetailsModalOpen(false);
                  }}
                  className="flex items-center gap-2"
                >
                  📊 Ver Análise Completa
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    // Copy UGR name to clipboard
                    navigator.clipboard?.writeText(selectedNodeForModal.name);
                  }}
                  className="flex items-center gap-2"
                >
                  📋 Copiar UGR
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setDetailsModalOpen(false)}
                  className="flex items-center gap-2"
                >
                  ❌ Fechar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
