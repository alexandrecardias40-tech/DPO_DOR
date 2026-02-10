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
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";

interface MenuItem {
  href: string;
  label: React.ReactNode;
  icon: React.ReactNode;
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
    { href: "/data-upload", label: "Atualizar Dados", icon: <Settings className="w-4 h-4" /> },
  ];

  const sections: MenuSectionConfig[] = useMemo(
    () =>
      (menuConfig && menuConfig.length > 0)
        ? menuConfig
        : [
          { key: "indicators", title: "📊 Indicadores", items: indicatorItems },
          { key: "charts", title: "📈 Gráficos", items: chartItems },
          { key: "comparatives", title: "🔄 Comparativos", items: comparativeItems },
        ],
    [menuConfig]
  );

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, true]))
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
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-colors text-sm ${isActive(item.href) ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
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
          {sidebarOpen && user && (
            <div className="text-xs text-slate-300 px-2 py-2 bg-slate-700 rounded-lg">
              <div className="font-semibold truncate">{user.name || "Usuário"}</div>
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
        {metadata?.updated_at && (
          <div className="absolute top-4 right-8 z-10">
            <div className="text-xs text-slate-500 bg-white/90 px-3 py-1.5 rounded-full border border-slate-200 shadow-sm backdrop-blur-sm flex items-center gap-2 transition-all hover:bg-white hover:shadow-md cursor-help" title={`Última atualização em: ${new Date(metadata.updated_at).toLocaleString('pt-BR')}`}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-medium">Atualizado:</span>
              {new Date(metadata.updated_at).toLocaleDateString('pt-BR')}
            </div>
          </div>
        )}
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
