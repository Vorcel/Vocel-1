import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useData } from "@/context/DataContext";

const ALL = "__all__";

export const AdvancedFilterSidebar = ({ open, onOpenChange, filters, setFilter, onClear }) => {
  const { lists } = useData();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="advanced-filter-sidebar">
        <SheetHeader>
          <SheetTitle className="font-heading">Filtros Avançados</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label>Objeto</Label>
            <Input data-testid="adv-objeto" value={filters.objeto} onChange={(e) => setFilter("objeto", e.target.value)} placeholder="Buscar objeto" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Pregão</Label>
              <Input data-testid="adv-pregao" value={filters.pregao} onChange={(e) => setFilter("pregao", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>UASG</Label>
              <Input data-testid="adv-uasg" value={filters.uasg} onChange={(e) => setFilter("uasg", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" data-testid="adv-data" value={filters.data} onChange={(e) => setFilter("data", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nº dos Itens</Label>
              <Input data-testid="adv-itens" value={filters.itens} onChange={(e) => setFilter("itens", e.target.value)} placeholder="Ex: 3" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Portal</Label>
            <Select value={filters.portal || ALL} onValueChange={(v) => setFilter("portal", v === ALL ? "" : v)}>
              <SelectTrigger data-testid="adv-portal"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(lists.portais || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Modalidade</Label>
            <Select value={filters.modalidade || ALL} onValueChange={(v) => setFilter("modalidade", v === ALL ? "" : v)}>
              <SelectTrigger data-testid="adv-modalidade"><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {(lists.modalidades || []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={filters.status || ALL} onValueChange={(v) => setFilter("status", v === ALL ? "" : v)}>
              <SelectTrigger data-testid="adv-status"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {(lists.statuses || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="fav-only" className="cursor-pointer">Somente favoritos</Label>
            <Switch id="fav-only" data-testid="adv-favoritos" checked={filters.favoritos} onCheckedChange={(v) => setFilter("favoritos", v)} />
          </div>
        </div>

        <SheetFooter className="mt-6 flex-row gap-2">
          <Button variant="outline" onClick={onClear} data-testid="adv-clear" className="flex-1">Limpar</Button>
          <Button onClick={() => onOpenChange(false)} data-testid="adv-apply" className="flex-1 bg-brand hover:bg-brand-hover">Aplicar</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
