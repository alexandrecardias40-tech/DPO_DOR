import React, { useEffect, useRef } from 'react';

interface AnimatedGraphProps {
    data: any[];
    onNodeClick?: (node: any) => void;
}

export function AnimatedGraph({ data, onNodeClick }: AnimatedGraphProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Explicitly cast or check to satisfy TS inside closures if needed, though 'if (!ctx) return' should work.
        // If TS complains inside 'animate', it might be losing context. 
        // Let's coerce it for simplicity in this specific block as we verified it above.
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        if (!ctx) return;

        let width = canvas.width;
        let height = canvas.height;
        let animationFrameId: number;

        // Process Data into Nodes
        // Map UGRs to nodes
        const nodes = data.map((item, index) => {
            const budget = item.Total_Anual_Estimado || 0;
            // Normalize size: min 15, max 40
            const maxBudget = Math.max(...data.map(d => d.Total_Anual_Estimado || 0));
            const minBudget = Math.min(...data.map(d => d.Total_Anual_Estimado || 0));
            const normalizedSize = maxBudget > minBudget
                ? ((budget - minBudget) / (maxBudget - minBudget))
                : 0.5;

            return {
                id: index,
                x: Math.random() * width,
                y: Math.random() * height,
                vx: 0,
                vy: 0,
                radius: 15 + normalizedSize * 25, // 15 to 40
                color: getColorForExecution(item.Percentual_Execucao),
                label: item.UGR || `UGR ${index}`,
                mass: 1 + normalizedSize * 2, // Bigger nodes are heavier
                data: item // Keep reference
            };
        });

        const edges: any[] = [];
        // CREATE CONNECTIONS
        // 1. Minimum Spanning Tree-like chain to ensure unity
        for (let i = 0; i < nodes.length - 1; i++) {
            edges.push({ source: nodes[i], target: nodes[i + 1] });
        }
        // 2. Extra connections for "web" look
        for (let i = 0; i < nodes.length * 1.5; i++) {
            let a = nodes[Math.floor(Math.random() * nodes.length)];
            let b = nodes[Math.floor(Math.random() * nodes.length)];
            if (a !== b) edges.push({ source: a, target: b });
        }

        // Camera State
        let camera = { x: width / 2, y: height / 2 }; // Center camera
        let isDragging = false;
        let lastMouse = { x: 0, y: 0 };
        let draggedNode: any = null;

        // Physics Constants
        const FRICTION = 0.9;
        const REPULSION = 3000;
        const SPRING_LENGTH = 200;
        const SPRING_STRENGTH = 0.02;
        const CENTER_GRAVITY = 0.002;

        function resize() {
            if (!canvas) return;
            const parent = canvas.parentElement;
            if (parent) {
                canvas.width = parent.clientWidth;
                canvas.height = 600; // Fixed height
                width = canvas.width;
                height = canvas.height;
                // Recenter logic if needed, but let's keep it simple
            }
        }
        window.addEventListener('resize', resize);
        resize();

        // Interaction Handlers (attached to canvas in React via refs usually, but native listeners work too for simple cases)
        const onMouseDown = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            isDragging = true;
            lastMouse = { x: mouseX, y: mouseY };

            // Check node click (World coords)
            const worldMouseX = mouseX - camera.x;
            const worldMouseY = mouseY - camera.y;

            for (let node of nodes) {
                let dx = worldMouseX - node.x;
                let dy = worldMouseY - node.y;
                if (dx * dx + dy * dy < node.radius * node.radius) {
                    draggedNode = node;
                    break;
                }
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const dx = mouseX - lastMouse.x;
            const dy = mouseY - lastMouse.y;

            if (draggedNode) {
                draggedNode.vx = 0;
                draggedNode.vy = 0;
                draggedNode.x += dx;
                draggedNode.y += dy;
            } else {
                camera.x += dx;
                camera.y += dy;
            }
            lastMouse = { x: mouseX, y: mouseY };
        };

        const onMouseUp = (e: MouseEvent) => {
            // Simple click detection (if not dragged far)
            if (!isDragging || (Math.abs(e.clientX - lastMouse.x) < 5 && Math.abs(e.clientY - lastMouse.y) < 5)) {
                // Check for click on node again just in case
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const worldMouseX = mouseX - camera.x;
                const worldMouseY = mouseY - camera.y;

                for (let node of nodes) {
                    let dx = worldMouseX - node.x;
                    let dy = worldMouseY - node.y;
                    if (dx * dx + dy * dy < node.radius * node.radius) {
                        if (onNodeClick) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            onNodeClick((node as any).data);
                        }
                        break;
                    }
                }
            }

            isDragging = false;
            draggedNode = null;
        };

        canvas.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mousemove', onMouseMove); // Window to catch drag outside
        window.addEventListener('mouseup', onMouseUp);


        function updatePhysics() {
            // Repulsion
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    let a = nodes[i];
                    let b = nodes[j];
                    let dx = a.x - b.x;
                    let dy = a.y - b.y;
                    let distSq = dx * dx + dy * dy;
                    if (distSq === 0) distSq = 1;
                    let dist = Math.sqrt(distSq);
                    let force = REPULSION / distSq;

                    let fx = (dx / dist) * force;
                    let fy = (dy / dist) * force;

                    a.vx += fx / a.mass;
                    a.vy += fy / a.mass;
                    b.vx -= fx / b.mass;
                    b.vy -= fy / b.mass;
                }
            }

            // Springs
            for (let edge of edges) {
                let a = edge.source;
                let b = edge.target;
                let dx = a.x - b.x;
                let dy = a.y - b.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let force = (dist - SPRING_LENGTH) * SPRING_STRENGTH;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;

                a.vx -= fx / a.mass;
                a.vy -= fy / a.mass;
                b.vx += fx / b.mass;
                b.vy += fy / b.mass;
            }

            // Gravity to center
            for (let node of nodes) {
                if (node === draggedNode) continue;
                node.vx -= node.x * CENTER_GRAVITY;
                node.vy -= node.y * CENTER_GRAVITY;

                // Update
                node.x += node.vx;
                node.y += node.vy;
                node.vx *= FRICTION;
                node.vy *= FRICTION;
            }
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);

            updatePhysics();

            ctx.save();
            ctx.translate(camera.x, camera.y);

            // Draw Links
            ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
            ctx.lineWidth = 1.5;
            for (let edge of edges) {
                ctx.beginPath();
                ctx.moveTo(edge.source.x, edge.source.y);
                ctx.lineTo(edge.target.x, edge.target.y);
                ctx.stroke();
            }

            // Draw Nodes
            for (let node of nodes) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = node.color;
                ctx.shadowBlur = 20;
                ctx.shadowColor = node.color;
                ctx.fill();
                ctx.shadowBlur = 0;

                // Label
                ctx.fillStyle = "white";
                ctx.font = "bold 12px Segoe UI, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(node.label, node.x, node.y);
            }

            ctx.restore();
            animationFrameId = requestAnimationFrame(animate);
        }

        animate();

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('resize', resize);
            canvas.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

    }, [data]); // Re-run if data changes

    return (
        <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '600px', cursor: 'grab', background: '#0f172a', borderRadius: '8px' }}
        />
    );
}

// Helpers
const COLORS = [
    "#FF5733", "#33FF57", "#3357FF", "#F3FF33",
    "#FF33F3", "#33FFF5", "#FF9933", "#9D33FF"
];

function getColorForExecution(percent: number) {
    // Or just unified vibrant palette like requested?
    // User asked "cores ... veja as principais variaveis".
    // Let's mix vibrancy with meaning if possible, or just random vibrant if meaning is muddy.
    // Let's stick to the vibrant random palette for "Ecosystem" feel as per previous request, 
    // unless we want strict coding. The user liked "bolas grandes e coloridas".
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}
