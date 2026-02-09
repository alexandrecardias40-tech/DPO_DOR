import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, ChevronDown } from "lucide-react";
import { getPiValue } from "@/lib/budget";

interface GlobalFiltersProps {
  data: any[];
  onFilterChange: (filters: FilterState) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = any;

export interface FilterState {
  uorg: string[];
  pi: string[];
  cnpj: string[];
  vigencia: string;
}

export default function GlobalFilters({ data, onFilterChange }: GlobalFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    uorg: [],
    pi: [],
    cnpj: [],
    vigencia: "",
  });

  const [expandedFilters, setExpandedFilters] = useState({
    uorg: false,
    pi: false,
    cnpj: false,
    vigencia: false,
  });

  // Extract unique values for dropdowns
  const uniqueValues = useMemo(() => {
    const uorgSet = new Set(data.map((item) => item.UGR).filter(Boolean));
    const piSet = new Set(data.map((item) => getPiValue(item)).filter(Boolean));
    const cnpjSet = new Set(data.map((item) => item.CNPJ).filter(Boolean));
    return {
      uorg: Array.from(uorgSet).sort(),
      pi: Array.from(piSet).sort(),
      cnpj: Array.from(cnpjSet).sort(),
    };
  }, [data]);

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const toggleFilter = (filterKey: keyof typeof expandedFilters) => {
    setExpandedFilters((prev) => ({
      ...prev,
      [filterKey]: !prev[filterKey],
    }));
  };

  const handleUorgToggle = (value: string) => {
    const newUorg = filters.uorg.includes(value)
      ? filters.uorg.filter((v) => v !== value)
      : [...filters.uorg, value];
    handleFilterChange({ ...filters, uorg: newUorg });
  };

  const handlePiToggle = (value: string) => {
    const newPi = filters.pi.includes(value)
      ? filters.pi.filter((v) => v !== value)
      : [...filters.pi, value];
    handleFilterChange({ ...filters, pi: newPi });
  };

  const handleCnpjToggle = (value: string) => {
    const newCnpj = filters.cnpj.includes(value)
      ? filters.cnpj.filter((v) => v !== value)
      : [...filters.cnpj, value];
    handleFilterChange({ ...filters, cnpj: newCnpj });
  };

  const clearAllFilters = () => {
    const emptyFilters: FilterState = {
      uorg: [],
      pi: [],
      cnpj: [],
      vigencia: "",
    };
    setFilters(emptyFilters);
    onFilterChange(emptyFilters);
  };

  const hasActiveFilters =
    filters.uorg.length > 0 ||
    filters.pi.length > 0 ||
    filters.cnpj.length > 0 ||
    filters.vigencia;

  return (
    <Card className="p-4 bg-white border-0 shadow-md mb-6">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Filtros Avançados</h3>
          {hasActiveFilters && (
            <Button
              onClick={clearAllFilters}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              Limpar Filtros
            </Button>
          )}
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* UOrg */}
          <div>
            <button
              onClick={() => toggleFilter("uorg")}
              className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>
                Unidades Organizacionais {filters.uorg.length > 0 && `(${filters.uorg.length})`}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  expandedFilters.uorg ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedFilters.uorg && (
              <div className="absolute mt-1 w-64 bg-white border border-slate-300 rounded-lg shadow-lg z-10 max-h-96 overflow-y-auto">
                {uniqueValues.uorg.map((value) => (
                  <label
                    key={value}
                    className="flex items-center px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={filters.uorg.includes(value)}
                      onChange={() => handleUorgToggle(value)}
                      className="mr-2"
                    />
                    {value}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* PI */}
          <div>
            <button
              onClick={() => toggleFilter("pi")}
              className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>PI {filters.pi.length > 0 && `(${filters.pi.length})`}</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  expandedFilters.pi ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedFilters.pi && (
              <div className="absolute mt-1 w-48 bg-white border border-slate-300 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                {uniqueValues.pi.map((value) => (
                  <label
                    key={value}
                    className="flex items-center px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={filters.pi.includes(value)}
                      onChange={() => handlePiToggle(value)}
                      className="mr-2"
                    />
                    {value}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* CNPJ */}
          <div>
            <button
              onClick={() => toggleFilter("cnpj")}
              className="w-full flex items-center justify-between px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span>
                CNPJ {filters.cnpj.length > 0 && `(${filters.cnpj.length})`}
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  expandedFilters.cnpj ? "rotate-180" : ""
                }`}
              />
            </button>
            {expandedFilters.cnpj && (
              <div className="absolute mt-1 w-48 bg-white border border-slate-300 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                {uniqueValues.cnpj.map((value) => (
                  <label
                    key={value}
                    className="flex items-center px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={filters.cnpj.includes(value)}
                      onChange={() => handleCnpjToggle(value)}
                      className="mr-2"
                    />
                    {value}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Vigência */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Vigência
            </label>
            <input
              type="date"
              value={filters.vigencia}
              onChange={(e) =>
                handleFilterChange({ ...filters, vigencia: e.target.value })
              }
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Active Filters Display */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
            {filters.uorg.map((value) => (
              <span
                key={`uorg-${value}`}
                className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium"
              >
                UOrg: {value}
                <button
                  onClick={() => handleUorgToggle(value)}
                  className="hover:text-green-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {filters.pi.map((value) => (
              <span
                key={`pi-${value}`}
                className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium"
              >
                PI: {value}
                <button
                  onClick={() => handlePiToggle(value)}
                  className="hover:text-purple-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {filters.cnpj.map((value) => (
              <span
                key={`cnpj-${value}`}
                className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-medium"
              >
                CNPJ: {value}
                <button
                  onClick={() => handleCnpjToggle(value)}
                  className="hover:text-orange-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {filters.vigencia && (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                Vigência: {filters.vigencia}
                <button
                  onClick={() =>
                    handleFilterChange({ ...filters, vigencia: "" })
                  }
                  className="hover:text-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
