import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useData } from "@/context/DataContext";
import { colorStyles, findColor } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ALL = "__all__";

export const AdvancedFilterSidebar = ({ open, onOpenChange, filters, setFilter, onClear }) => {
  const { lists } = useData();
  const statusSel = Array.isArray(filters.status) ? filters.status : [];

  const toggleStatus = (nome) =>
    setFilter("status", statusSel.includes(nome) ? statusSel.filter((s) => s !== nome) : [...statusSel, nome]);
  const toggleModalidade = (m) => setFilter("modalidade", filters.modalidade === m ? "" : m);
  const setData = (k, v) => setFilter("data", { ...filters.data, [k]: v });

  const apply = () => onOpenChange(false);
  const clearAll = () => { onClear(); onOpenChange(false); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md" data-testid="advanced-filter-sidebar">
        {/* Header */}
        <div className="border-b border-border px-6 py-5">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Filtros Avançados</h2>
          <p className="text-sm text-muted-foreground">Refine os resultados da sua busca de licitações</p>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-1.5">
            <Label>Objeto</Label>
            <Input data-testid="adv-objeto" value={filters.objeto} onChange={(e) => setFilter("objeto", e.target.value)} placeholder="Buscar por palavra-chave no objeto" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Pregão</Label>
              <Input data-testid="adv-pregao" value={filters.pregao} onChange={(e) => setFilter("pregao", e.target.value)} placeholder="Nº do pregão" />
            </div>
            <div className="space-y-1.5">
              <Label>UASG</Label>
              <Input data-testid="adv-uasg" value={filters.uasg} onChange={(e) => setFilter("uasg", e.target.value)} placeholder="Nº UASG" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Filtrar por Data</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">De</span>
                <Input type="date" data-testid="adv-data-from" value={filters.data?.from || ""} onChange={(e) => setData("from", e.target.value)} />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Até</span>
                <Input type="date" data-testid="adv-data-to" value={filters.data?.to || ""} onChange={(e) => setData("to", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Portal</Label>
              <Select value={filters.portal || ALL} onValueChange={(v) => setFilter("portal", v === ALL ? "" : v)}>
                <SelectTrigger data-testid="adv-portal"><SelectValue placeholder="Todos os Portais" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os Portais</SelectItem>
                  {(lists.portais || []).map((p) => <SelectItem key={p.nome} value={p.nome}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nº dos Itens</Label>
              <Input data-testid="adv-itens" value={filters.itens} onChange={(e) => setFilter("itens", e.target.value)} placeholder="Ex: 3" />
            </div>
          </div>

          {/* Modalidade — toggle buttons */}
          <div className="space-y-2">
            <Label>Modalidade</Label>
            <div className="flex flex-wrap gap-2">
              {(lists.modalidades || []).map((m) => {
                const sel = filters.modalidade === m.nome;
                return (
                  <button
                    key={m.nome} type="button" data-testid={`adv-modalidade-${m.nome}`} onClick={() => toggleModalidade(m.nome)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      sel ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:border-foreground/40"
                    )}
                  >
                    {m.nome}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status — chips de múltipla seleção (dinâmicos, com bolinha colorida) */}
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex flex-wrap gap-2">
              {(lists.statuses || []).map((s) => {
                const sel = statusSel.includes(s.nome);
                return (
                  <button
                    key={s.nome} type="button" data-testid={`adv-status-${s.nome}`} onClick={() => toggleStatus(s.nome)}
                    style={sel ? colorStyles(s.cor).badgeDark : undefined}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      sel ? "ring-1 ring-foreground/20" : "border-border bg-card text-muted-foreground hover:border-foreground/40"
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.cor }} />
                    {s.nome}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status da Proposta</Label>
            <Select value={filters.proposta || "all"} onValueChange={(v) => setFilter("proposta", v)}>
              <SelectTrigger data-testid="adv-proposta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="sent">Apenas Enviadas (P)</SelectItem>
                <SelectItem value="notsent">Não Enviadas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="fav-only" className="cursor-pointer">Somente favoritos</Label>
            <Switch id="fav-only" data-testid="adv-favoritos" checked={filters.favoritos} onCheckedChange={(v) => setFilter("favoritos", v)} />
          </div>
        </div>

        {/* Footer (fixo) */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={clearAll} data-testid="adv-clear" className="flex-1">Limpar Filtros</Button>
          <Button onClick={apply} data-testid="adv-apply" className="flex-1 bg-[#1A1A1A] text-white hover:bg-black">Aplicar Filtros</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};
