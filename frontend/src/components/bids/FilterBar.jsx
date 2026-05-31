import { Search, SlidersHorizontal, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/DateRangePicker";
import { cn } from "@/lib/utils";

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
      <DateRangePicker
        value={filters.data}
        onChange={(r) => setFilter("data", r)}
        testid="filter-data"
        className="sm:w-60"
      />
      <button
        type="button"
        data-testid="filter-fav-toggle"
        onClick={() => setFilter("favoritos", !filters.favoritos)}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors",
          filters.favoritos ? "border-amber-400 bg-amber-50 text-amber-500" : "border-input text-muted-foreground hover:bg-accent"
        )}
        title="Somente favoritos"
      >
        <Star size={16} className={cn(filters.favoritos && "fill-amber-400")} />
      </button>
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
