import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { APP_LOGO, APP_TITLE } from "@/const";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  AlertCircle,
  TrendingUp,
  Settings,
  Menu,
  X,
  Home,
  PieChart,
  LineChart,
  Activity,
  GitCompare,
  ChevronDown,
  FileText,
  Download,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

interface MenuItem {
  href: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  external?: boolean;
}

interface MenuSectionConfig {
  key: string;
  title: string;
  items: MenuItem[];
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  menuConfig?: MenuSectionConfig[];
}

export default function DashboardLayout({ children, menuConfig }: DashboardLayoutProps) {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [location] = useLocation();

  const { data: metadata } = trpc.budget.getMetadata.useQuery();

  const indicatorItems: MenuItem[] = [
    { href: "/", label: "Dashboard Principal", icon: <Home className="w-4 h-4" /> },
  ];

  const chartItems: MenuItem[] = [
    { href: "/charts/ecosystem", label: "Ecossistema Orçamentário", icon: <Activity className="w-4 h-4" /> },
  ];

  const comparativeItems: MenuItem[] = [
    { href: "/comparisons", label: "Comparativo Geral", icon: <GitCompare className="w-4 h-4" /> },
    {
      href: "/predictive-analysis",
      label: (
        <span className="flex items-center gap-2">
          Análise Preditiva
          <span className="text-[10px] opacity-70">(em construção)</span>
        </span>
      ),
      icon: <TrendingUp className="w-4 h-4" />,
    },
  ];

  const updateItems: MenuItem[] = [
    { href: "/data-upload", label: "Atualizar Dados", icon: <Settings className="w-4 h-4" /> },
    { href: "/api/dashboard/download-latest", label: "Baixar Última Planilha", icon: <Download className="w-4 h-4" />, external: true },
  ];

  const reportItems: MenuItem[] = [
    { href: "/saiku/", label: "Business Inteligence", icon: <FileText className="w-4 h-4" />, external: true },
  ];

  const sections: MenuSectionConfig[] = useMemo(
    () =>
      (menuConfig && menuConfig.length > 0)
        ? menuConfig
        : [
          { key: "indicators", title: "📊 Indicadores", items: indicatorItems },
          { key: "charts", title: "📈 Gráficos", items: chartItems },
          { key: "comparatives", title: "🔄 Comparativos", items: comparativeItems },
          { key: "reports", title: "📑 Gerador de Relatórios", items: reportItems },
          { key: "updates", title: "⚙️ Atualizações", items: updateItems },
        ],
    [menuConfig]
  );

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, false]))
  );

  useEffect(() => {
    setExpandedSections((prev) => {
      const next = { ...prev };
      sections.forEach((section) => {
        if (!(section.key in next)) {
          next[section.key] = true;
        }
      });
      return next;
    });
  }, [sections]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const isActive = (href: string) => location === href;

  const MenuSection = ({
    title,
    items,
    sectionKey,
  }: {
    title: string;
    items: MenuItem[];
    sectionKey: string;
  }) => (
    <div className="mb-2">
      <button
        onClick={() => toggleSection(sectionKey)}
        className="w-full flex items-center justify-between px-4 py-3 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors font-semibold text-sm"
      >
        <span>{title}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${expandedSections[sectionKey] ? "rotate-0" : "-rotate-90"}`}
        />
      </button>
      {expandedSections[sectionKey] && (
        <div className="space-y-1 mt-1 ml-2">
          {items.map((item) => {
            const className = `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors text-sm ${isActive(item.href) ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`;

            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={className}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </a>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={className}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "w-72" : "w-20"
          } bg-gradient-to-b from-slate-900 to-slate-800 text-white transition-all duration-300 flex flex-col border-r border-slate-700 shadow-xl`}
      >
        {/* Logo Section */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-3">
              {APP_LOGO && (
                <img
                  src={APP_LOGO}
                  alt="Logo"
                  className="w-10 h-10 rounded-lg shadow-md"
                />
              )}
              <div>
                <h1 className="text-sm font-bold text-white truncate tracking-tight">
                  {APP_TITLE}
                </h1>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors ml-auto"
          >
            {sidebarOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Navigation Menu */}
        {sidebarOpen && (
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {sections.map((section) => (
              <MenuSection key={section.key} title={section.title} items={section.items} sectionKey={section.key} />
            ))}
          </nav>
        )}

        {/* User Section */}
        <div className="p-4 border-t border-slate-700 space-y-3">
          {sidebarOpen && user && user.email && (
            <div className="text-xs text-slate-300 px-2 py-2 bg-slate-700 rounded-lg">
              <div className="text-slate-400 text-xs truncate">{user.email}</div>
            </div>
          )}
          {/* Link to go back to the main program (Saiku root). When the SPA is embedded
              under /dashboard this allows users to return to the host application. */}
          <a
            href="/"
            className="w-full flex items-center gap-2 px-4 py-2 text-slate-300 hover:bg-slate-700 rounded-lg transition-colors text-sm font-medium"
          >
            <Home className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span>Sair</span>}
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-50 relative">
        <div className="absolute top-4 right-8 z-10 flex flex-col items-end gap-2">
          {metadata?.updated_at && (
            <div className="relative group">
              <div
                className="text-xs text-slate-500 bg-white/90 px-3 py-1.5 rounded-full border border-slate-200 shadow-sm backdrop-blur-sm flex items-center gap-2 transition-all hover:bg-white hover:shadow-md cursor-help"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-medium">Atualizado:</span>
                {new Date(metadata.updated_at).toLocaleDateString('pt-BR')}
              </div>

              {/* Tooltip rico — aparece ao passar o cursor */}
              <div className="absolute right-0 top-full mt-2 z-50 hidden group-hover:flex flex-col gap-1 bg-slate-900 text-white text-xs rounded-xl shadow-xl p-3 min-w-[240px] border border-slate-700 pointer-events-none">
                <div className="flex items-center gap-2 font-semibold text-emerald-400 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Última Atualização
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Data:</span>
                  <span className="text-white font-medium">
                    {new Date(metadata.updated_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-400">Hora:</span>
                  <span className="text-white font-medium">
                    {new Date(metadata.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                {(metadata as any).updated_by_email && (
                  <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-slate-700">
                    <span className="text-slate-400">Remetente:</span>
                    <span className="text-blue-300 font-medium text-right max-w-[160px] break-all">
                      {(metadata as any).updated_by_email}
                    </span>
                  </div>
                )}
                {(metadata as any).source_file && (
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-400">Arquivo:</span>
                    <span className="text-slate-300 font-medium text-right max-w-[160px] break-all">
                      {(metadata as any).source_file}
                    </span>
                  </div>
                )}
                {/* Seta do tooltip */}
                <div className="absolute -top-1.5 right-6 w-3 h-3 bg-slate-900 border-l border-t border-slate-700 rotate-45"></div>
              </div>
            </div>
          )}

        </div>
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
