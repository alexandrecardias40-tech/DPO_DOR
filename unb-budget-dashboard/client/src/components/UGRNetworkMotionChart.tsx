import { useEffect, useMemo, useState, useRef } from 'react';

type UGRItem = {
  UGR: string;
  Total_Anual_Estimado: number;
  Total_Empenho_RAP: number;
  Percentual_Execucao: number;
  Contratos_Ativos: number;
  Contratos_Expirados: number;
};

type UGRNetworkMotionChartProps = {
  data: UGRItem[];
  height?: number;
};

type NetworkNode = {
  id: string;
  label: string;
  budget: number;
  executed: number;
  executionPercent: number;
  contracts: number;
  size: number;
  color: string;
  phase: number;
  isHub: boolean;
  ringIndex: number;
};

type NetworkLink = {
  id: string;
  source: string;
  target: string;
  speed: number;
  phase: number;
  glow: string;
};

type Point = {
  x: number;
  y: number;
};

const WIDTH = 1000;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const MAX_VISIBLE_UGRS = 12;

const NODE_COLORS = [
  '#2f6bff',
  '#13c7d6',
  '#ff6b00',
  '#f9d600',
  '#2ed11e',
  '#ff2d95',
  '#7a4dff',
  '#ff9f1c',
  '#00d3a7',
  '#d163ff',
  '#4cc9f0',
  '#f72585',
];

const seeded = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const lerp = (a: number, b: number, t: number) => {
  return a + (b - a) * t;
};

const formatShortLabel = (label: string, maxLength = 14) => {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1)}…`;
};

export default function UGRNetworkMotionChart({ data, height = 540, onNodeClick }: UGRNetworkMotionChartProps & { onNodeClick?: (ugr: UGRItem) => void }) {
  const [time, setTime] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // Interaction State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [nodeOverrides, setNodeOverrides] = useState<Map<string, Point>>(new Map());
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [dragStartMouse, setDragStartMouse] = useState({ x: 0, y: 0 }); // To detect clicks vs drags

  useEffect(() => {
    let animationFrame = 0;

    const animate = (nextTime: number) => {
      setTime(nextTime);
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  // Convert screen coordinates to SVG coordinates
  const getSVGPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(svg.getScreenCTM()?.inverse());
  };

  const handleMouseDown = (e: React.MouseEvent, nodeId?: string) => {
    e.stopPropagation();
    e.preventDefault(); // Prevent text selection

    setLastMouse({ x: e.clientX, y: e.clientY });
    setDragStartMouse({ x: e.clientX, y: e.clientY });

    if (nodeId) {
      setDraggedNodeId(nodeId);
    } else {
      setIsDragging(true); // Panning background
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Panning
    if (isDragging) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMouse({ x: e.clientX, y: e.clientY });
      return;
    }

    // Node Dragging
    if (draggedNodeId) {
      const currentSVGPos = getSVGPoint(e.clientX, e.clientY);
      // For smoother dragging, we could use offset from center
      // But setting directly to mouse pos (mapped to SVG) is reliable.

      setNodeOverrides(prev => {
        const newMap = new Map(prev);
        newMap.set(draggedNodeId, { x: currentSVGPos.x, y: currentSVGPos.y });
        return newMap;
      });

      setLastMouse({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDraggedNodeId(null);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setDraggedNodeId(null);
  };

  // Check click vs drag for node navigation
  const handleNodeClick = (e: React.MouseEvent, node: any) => {
    const dist = Math.hypot(e.clientX - dragStartMouse.x, e.clientY - dragStartMouse.y);
    if (dist < 5 && onNodeClick && node.originalData) {
      onNodeClick(node.originalData);
    }
  };

  const stars = useMemo(() => {
    return Array.from({ length: 220 }, (_, index) => ({
      id: `star-${index}`,
      x: seeded(index + 11) * WIDTH,
      y: seeded(index + 73) * HEIGHT,
      radius: 0.35 + seeded(index + 131) * 1.8,
      phase: seeded(index + 211) * Math.PI * 2,
      intensity: 0.2 + seeded(index + 271) * 0.8,
    }));
  }, []);

  const nodes = useMemo<NetworkNode[]>(() => {
    const ordered = [...(data || [])]
      .sort((a, b) => (b.Total_Anual_Estimado || 0) - (a.Total_Anual_Estimado || 0))
      .slice(0, MAX_VISIBLE_UGRS);

    const maxBudget = Math.max(...ordered.map((item) => item.Total_Anual_Estimado || 0), 1);
    const minBudget = Math.min(...ordered.map((item) => item.Total_Anual_Estimado || 0), maxBudget);

    const visibleNodes = ordered.map((item, index) => {
      const budget = item.Total_Anual_Estimado || 0;
      const normalizedBudget = maxBudget === minBudget ? 0.6 : (budget - minBudget) / (maxBudget - minBudget);
      const size = clamp(26 + normalizedBudget * 26, 24, 56);

      return {
        id: `ugr-${index}`,
        label: item.UGR || `UGR ${index + 1}`,
        budget,
        executed: item.Total_Empenho_RAP || 0,
        executionPercent: item.Percentual_Execucao || 0,
        contracts: (item.Contratos_Ativos || 0) + (item.Contratos_Expirados || 0),
        size,
        color: NODE_COLORS[index % NODE_COLORS.length],
        phase: seeded(index + 541) * Math.PI * 2,
        isHub: false,
        ringIndex: index,
        originalData: item
      };
    });

    const hubBudget = visibleNodes.reduce((sum, node) => sum + node.budget, 0);
    const hubExecuted = visibleNodes.reduce((sum, node) => sum + node.executed, 0);
    const hubContracts = visibleNodes.reduce((sum, node) => sum + node.contracts, 0);

    const hub: NetworkNode & { originalData?: any } = {
      id: 'unb-hub',
      label: 'UnB',
      budget: hubBudget,
      executed: hubExecuted,
      executionPercent: hubBudget > 0 ? (hubExecuted / hubBudget) * 100 : 0,
      contracts: hubContracts,
      size: 58,
      color: '#2f6bff',
      phase: 0,
      isHub: true,
      ringIndex: -1,
    };

    return [hub, ...visibleNodes];
  }, [data]);

  // Make nodePositions rely on nodeOverrides
  const nodePositions = useMemo(() => {
    const positions = new Map<string, Point>();
    const ringNodes = nodes.filter((node) => !node.isHub);
    const orbitCount = Math.max(ringNodes.length, 1);

    nodes.forEach((node) => {
      // Check override first
      if (nodeOverrides.has(node.id)) {
        positions.set(node.id, nodeOverrides.get(node.id)!);
        return;
      }

      if (node.isHub) {
        const x = CENTER_X + Math.sin(time * 0.00028) * 18;
        const y = CENTER_Y - 24 + Math.cos(time * 0.00026) * 10;
        positions.set(node.id, { x, y });
        return;
      }

      const angleBase = (node.ringIndex / orbitCount) * Math.PI * 2;
      const angle =
        angleBase +
        time * 0.00016 +
        Math.sin(time * 0.00045 + node.phase) * 0.12;

      const ringRadius = 190 + (node.ringIndex % 3) * 34;
      const wobble = 11 + node.size * 0.2;

      const x =
        CENTER_X +
        Math.cos(angle) * ringRadius +
        Math.sin(time * 0.0012 + node.phase) * wobble;

      const y =
        CENTER_Y +
        Math.sin(angle) * (ringRadius * 0.62) +
        Math.cos(time * 0.001 + node.phase) * wobble * 0.6;

      positions.set(node.id, { x, y });
    });

    return positions;
  }, [nodes, time, nodeOverrides]);

  const links = useMemo<NetworkLink[]>(() => {
    if (nodes.length <= 1) return [];

    const ringNodes = nodes.filter((node) => !node.isHub);
    const nextLinks: NetworkLink[] = [];

    ringNodes.forEach((node, index) => {
      nextLinks.push({
        id: `hub-${node.id}`,
        source: 'unb-hub',
        target: node.id,
        speed: 0.00022 + (index % 4) * 0.00003,
        phase: seeded(index + 41),
        glow: 'rgba(255,255,255,0.9)',
      });
    });

    ringNodes.forEach((node, index) => {
      const next = ringNodes[(index + 1) % ringNodes.length];
      const jump = ringNodes[(index + 3) % ringNodes.length];

      nextLinks.push({
        id: `ring-${node.id}-${next.id}`,
        source: node.id,
        target: next.id,
        speed: 0.00015 + (index % 3) * 0.00003,
        phase: seeded(index + 113),
        glow: 'rgba(255,255,255,0.65)',
      });

      if (ringNodes.length > 5 && index % 2 === 0) {
        nextLinks.push({
          id: `jump-${node.id}-${jump.id}`,
          source: node.id,
          target: jump.id,
          speed: 0.00014 + (index % 5) * 0.000025,
          phase: seeded(index + 181),
          glow: 'rgba(255,200,120,0.7)',
        });
      }
    });

    return nextLinks;
  }, [nodes]);

  const activeNodes = nodes.filter((node) => !node.isHub);

  if (activeNodes.length === 0) {
    return (
      <div className="h-[420px] rounded-xl border border-slate-700/60 bg-slate-950/90 flex items-center justify-center text-slate-300">
        Sem dados de UGR para montar o grafo.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-slate-700/70 bg-slate-950 shadow-[0_0_40px_rgba(15,23,42,0.7)] overflow-hidden cursor-move"
      onMouseDown={(e) => handleMouseDown(e)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        ref={svgRef}
        viewBox={`${-pan.x} ${-pan.y} ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor: isDragging ? 'grabbing' : draggedNodeId ? 'move' : 'grab' }}
      >
        <defs>
          <radialGradient id="space-bg" cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#102a58" />
            <stop offset="35%" stopColor="#071a3a" />
            <stop offset="100%" stopColor="#030b1c" />
          </radialGradient>

          {nodes.map((node) => (
            <radialGradient key={`grad-${node.id}`} id={`grad-${node.id}`} cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="26%" stopColor={node.color} stopOpacity="0.98" />
              <stop offset="100%" stopColor={node.color} stopOpacity="0.5" />
            </radialGradient>
          ))}
        </defs>

        {/* Background moves with pan */}
        <rect x={-pan.x} y={-pan.y} width={WIDTH} height={HEIGHT} fill="url(#space-bg)"
          // Make background huge so we don't see edges when panning
          transform={`scale(3) translate(${-WIDTH / 2}, ${-HEIGHT / 2})`}
        />

        {stars.map((star) => {
          const twinkle = 0.45 + 0.55 * Math.sin(time * 0.0011 + star.phase);
          return (
            <circle
              key={star.id}
              cx={star.x}
              cy={star.y}
              r={star.radius}
              fill="white"
              opacity={star.intensity * twinkle}
            />
          );
        })}

        {links.map((link) => {
          const source = nodePositions.get(link.source);
          const target = nodePositions.get(link.target);
          if (!source || !target) return null;

          return (
            <g key={link.id}>
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="rgba(180,205,255,0.18)"
                strokeWidth={1.8}
              />
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={link.glow}
                strokeOpacity={0.35}
                strokeWidth={1.2}
              />

              {[0, 0.5].map((offset, index) => {
                const progress = (time * link.speed + link.phase + offset) % 1;
                const px = lerp(source.x, target.x, progress);
                const py = lerp(source.y, target.y, progress);
                const radius = index === 0 ? 3.1 : 2.2;

                return (
                  <circle
                    key={`${link.id}-spark-${index}`}
                    cx={px}
                    cy={py}
                    r={radius}
                    fill="white"
                    opacity={0.85}
                    style={{ filter: 'drop-shadow(0 0 7px rgba(255,255,255,0.95))' }}
                  />
                );
              })}
            </g>
          );
        })}

        {nodes.map((node) => {
          const position = nodePositions.get(node.id);
          if (!position) return null;

          const label = formatShortLabel(node.label, node.isHub ? 10 : 16);
          const labelSize = node.isHub ? 16 : Math.max(11, Math.min(16, node.size * 0.3));
          const outline = node.isHub ? 'rgba(132,204,255,0.9)' : 'rgba(255,255,255,0.5)';
          const halo = node.isHub ? node.size + 14 : node.size + 10;

          return (
            <g
              key={node.id}
              onMouseDown={(e) => handleMouseDown(e, node.id)}
              onClick={(e) => handleNodeClick(e, node)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={position.x}
                cy={position.y}
                r={halo}
                fill={node.color}
                opacity={node.isHub ? 0.27 : 0.2}
                style={{ filter: `blur(${node.isHub ? 4 : 3}px)` }}
              />
              <circle
                cx={position.x}
                cy={position.y}
                r={node.size}
                fill={`url(#grad-${node.id})`}
                stroke={outline}
                strokeWidth={node.isHub ? 2.2 : 1.5}
                style={{ filter: `drop-shadow(0 0 ${node.isHub ? 18 : 13}px ${node.color})` }}
              />
              <circle
                cx={position.x - node.size * 0.22}
                cy={position.y - node.size * 0.24}
                r={node.size * 0.18}
                fill="white"
                opacity={0.38}
              />

              <text
                x={position.x}
                y={position.y + labelSize * 0.28}
                textAnchor="middle"
                fontSize={labelSize}
                fontWeight={700}
                fill="#f8fafc"
                style={{
                  letterSpacing: '0.2px',
                  textShadow: '0 1px 4px rgba(0, 0, 0, 0.55)',
                  pointerEvents: 'none',
                }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="px-4 py-3 border-t border-slate-700/60 bg-slate-900/70 text-[11px] md:text-xs text-slate-300 flex flex-wrap gap-3">
        <span>• Nós = UGRs (top {Math.min(MAX_VISIBLE_UGRS, activeNodes.length)} por orçamento)</span>
        <span>• Tamanho da esfera = orçamento total</span>
        <span>• Linhas brilhantes = relacionamento/fluxo entre UGRs</span>
        <span className="text-blue-300 ml-auto font-semibold">🖱️ Arraste para mover • Clique para detalhes</span>
      </div>
    </div>
  );
}
