import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const FilterBar = ({ filters, setFilter, onOpenAdvanced, activeAdvanced }) => {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="filter-objeto"
          value={filters.objeto}
          onChange={(e) => setFilter("objeto", e.target.value)}
          placeholder="Buscar por objeto..."
          className="pl-9"
        />
      </div>
      <Input
        data-testid="filter-pregao"
        value={filters.pregao}
        onChange={(e) => setFilter("pregao", e.target.value)}
        placeholder="Pregão"
        className="sm:w-36"
      />
      <Input
        data-testid="filter-uasg"
        value={filters.uasg}
        onChange={(e) => setFilter("uasg", e.target.value)}
        placeholder="UASG"
        className="sm:w-32"
      />
      <Input
        type="date"
        data-testid="filter-data"
        value={filters.data}
        onChange={(e) => setFilter("data", e.target.value)}
        className="sm:w-40"
      />
      <Button
        variant="outline"
        onClick={onOpenAdvanced}
        data-testid="filter-advanced-open"
        className="relative shrink-0"
      >
        <SlidersHorizontal size={16} className="mr-2" />
        Filtros
        {activeAdvanced > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
            {activeAdvanced}
          </span>
        )}
      </Button>
    </div>
  );
};
