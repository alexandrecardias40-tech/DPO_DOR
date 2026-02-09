import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Home from "@/pages/Home";
import Alerts from "@/pages/Alerts";
import Comparisons from "@/pages/Comparisons";
import KPIs from "@/pages/KPIs";
import ChartsMonthly from "@/pages/ChartsMonthly";
import ChartsDistribution from "@/pages/ChartsDistribution";
import BudgetEcosystem from "@/pages/BudgetEcosystem";
import ChartsExecution from "@/pages/ChartsExecution";
import TestGraph from "@/pages/TestGraph";
import SimpleTest from "@/pages/SimpleTest";
import ComparisonsUGR from "@/pages/ComparisonsUGR";
import Trends from "@/pages/Trends";
import DataUpload from "@/pages/DataUpload";
import UGRDetails from "@/pages/UGRDetails";
import PredictiveAnalysis from "@/pages/PredictiveAnalysis";
import EmendasDashboard from "@/pages/EmendasDashboard";
import { Route, Switch, Router as WouterRouter } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const DEFAULT_BASE =
  (import.meta.env.BASE_URL ? import.meta.env.BASE_URL.replace(/\/$/, "") : "") || "";

const detectBasePath = () => {
  if (typeof window === "undefined") {
    return DEFAULT_BASE;
  }
  if (window.location.pathname.startsWith("/dashboard")) {
    return "/dashboard";
  }
  return "";
};

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/kpis" component={KPIs} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/comparisons" component={Comparisons} />
      <Route path="/charts/monthly" component={ChartsMonthly} />
      <Route path="/charts/distribution" component={ChartsDistribution} />
      <Route path="/charts/ecosystem" component={BudgetEcosystem} />
      <Route path="/test-graph" component={TestGraph} />
      <Route path="/simple-test" component={SimpleTest} />
      <Route path="/charts/execution" component={ChartsExecution} />
      <Route path="/comparisons-ugr" component={ComparisonsUGR} />
      <Route path="/trends" component={Trends} />
      <Route path="/data-upload" component={DataUpload} />
      <Route path="/ugr-details" component={UGRDetails} />
      <Route path="/predictive-analysis" component={PredictiveAnalysis} />
      <Route path="/emendas" component={EmendasDashboard} />
      <Route path="/emendas/" component={EmendasDashboard} />
      <Route path="/404" component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const basePath = detectBasePath();

  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
      >
        <TooltipProvider>
          <Toaster />
          <WouterRouter base={basePath}>
            <AppRoutes />
          </WouterRouter>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
