import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";

// Dynamic import for ForceGraph3D to avoid SSR issues
let ForceGraph3D: any = null;

export default function SimpleTest() {
  const [graphLoaded, setGraphLoaded] = useState(false);

  // Load ForceGraph3D dynamically
  useEffect(() => {
    if (typeof window !== 'undefined' && !ForceGraph3D) {
      console.log('Loading ForceGraph3D...');
      import('react-force-graph-3d').then(module => {
        console.log('ForceGraph3D loaded successfully');
        ForceGraph3D = module.default;
        setGraphLoaded(true);
      }).catch(error => {
        console.error('Failed to load ForceGraph3D:', error);
        setGraphLoaded(true);
      });
    } else {
      console.log('ForceGraph3D already loaded');
      setGraphLoaded(true);
    }
  }, []);

  // Test data similar to what might be shown in the image - more nodes and connections
  const graphData = useMemo(() => {
    console.log('Creating test graph data');
    return {
      nodes: [
        { id: 'A', name: 'Node A', val: 15, color: '#ff6b6b' },
        { id: 'B', name: 'Node B', val: 20, color: '#4ecdc4' },
        { id: 'C', name: 'Node C', val: 25, color: '#45b7d1' },
        { id: 'D', name: 'Node D', val: 18, color: '#f9ca24' },
        { id: 'E', name: 'Node E', val: 22, color: '#f0932b' },
        { id: 'F', name: 'Node F', val: 16, color: '#eb4d4b' },
        { id: 'G', name: 'Node G', val: 19, color: '#6c5ce7' },
        { id: 'H', name: 'Node H', val: 21, color: '#a29bfe' }
      ],
      links: [
        { source: 'A', target: 'B', value: 1 },
        { source: 'B', target: 'C', value: 1.5 },
        { source: 'C', target: 'D', value: 1 },
        { source: 'D', target: 'E', value: 0.8 },
        { source: 'E', target: 'F', value: 1.2 },
        { source: 'F', target: 'G', value: 1 },
        { source: 'G', target: 'H', value: 1.3 },
        { source: 'A', target: 'C', value: 0.7 },
        { source: 'B', target: 'D', value: 0.9 },
        { source: 'C', target: 'E', value: 1.1 },
        { source: 'D', target: 'F', value: 0.8 },
        { source: 'E', target: 'G', value: 1.4 },
        { source: 'F', target: 'H', value: 1.2 }
      ]
    };
  }, []);

  console.log('SimpleTest rendering, graphData:', graphData);

  return (
    <DashboardLayout>
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Grafo 3D - Teste Funcional</h1>
        <div className="h-[600px] w-full border rounded-lg overflow-hidden bg-slate-900" style={{ height: '600px', width: '100%' }}>
          {!graphLoaded ? (
            <div className="h-full flex items-center justify-center text-white">
              Carregando grafo 3D...
            </div>
          ) : ForceGraph3D ? (
            <ForceGraph3D
              graphData={graphData}
              nodeColor={(node: any) => node.color}
              nodeVal={(node: any) => node.val}
              nodeLabel={(node: any) => `${node.name} (valor: ${node.val})`}
              linkColor={() => '#ffffff'}
              linkWidth={(link: any) => link.value * 2}
              linkOpacity={0.6}
              backgroundColor="#0f172a"
              enableNodeDrag={true}
              enableNavigationControls={true}
              showNavInfo={true}
              nodeResolution={16}
              linkResolution={6}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              style={{ height: '100%', width: '100%' }}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-red-400">
              Erro ao carregar grafo 3D
            </div>
          )}
        </div>
        <div className="mt-4 text-sm text-gray-600">
          <p>Grafo 3D com {graphData.nodes.length} nós e {graphData.links.length} conexões</p>
          <p>Arraste os nós, use o mouse para navegar, e passe o mouse sobre os nós para ver labels</p>
        </div>
      </div>
    </DashboardLayout>
  );
}