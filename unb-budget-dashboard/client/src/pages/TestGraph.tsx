import { useState, useEffect } from "react";

export default function TestGraph() {
  const [ForceGraph2D, setForceGraph2D] = useState<any>(null);

  useEffect(() => {
    import('react-force-graph-2d').then(module => {
      console.log('ForceGraph2D loaded');
      setForceGraph2D(() => module.default);
    }).catch(error => {
      console.error('Failed to load ForceGraph2D:', error);
    });
  }, []);

  const testData = {
    nodes: [
      { id: 'a', name: 'Node A', val: 10, color: '#ff0000' },
      { id: 'b', name: 'Node B', val: 15, color: '#00ff00' },
      { id: 'c', name: 'Node C', val: 20, color: '#0000ff' }
    ],
    links: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' }
    ]
  };

  console.log('TestGraph rendering, ForceGraph2D:', ForceGraph2D);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Teste Grafo 2D</h1>
      <div className="h-[600px] w-full border rounded-lg overflow-hidden bg-white" style={{ height: '600px', width: '100%' }}>
        {ForceGraph2D ? (
          <ForceGraph2D
            graphData={testData}
            nodeColor={(node: any) => node.color}
            nodeVal={(node: any) => node.val}
            style={{ height: '100%', width: '100%' }}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            Carregando ForceGraph2D...
          </div>
        )}
      </div>
    </div>
  );
}