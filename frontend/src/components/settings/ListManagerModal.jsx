import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { configDoTipo } from "@/components/settings/listTypes";
import { useData } from "@/context/DataContext";
import { ANALYTIC_CATEGORIES, DEFAULT_ANALYTIC_CATEGORY } from "@/lib/analytics";
import { smartTitleCase } from "@/lib/textcase";
import { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Modal ÚNICO de gerenciamento de uma lista de parâmetros (ref 6): lista à
// esquerda (ordenável por arraste) e formulário à direita, servindo tanto para
// criar quanto para editar. Vale para status, portais e modalidades — os
// rótulos vêm de listTypes.js e a Categoria Analítica / "Exibir no gráfico"
// aparecem só onde fazem sentido (status).
// A fonte dos dados é sempre `lists[tipo]` do DataContext — sem lista paralela
// e sem mapeamento fixo no código.
const COR_PADRAO = "#0C7B93";
const NOVO = "__novo__";

const vazio = () => ({
  nome: "", cor: COR_PADRAO, categoria: DEFAULT_ANALYTIC_CATEGORY, grafico: true, ativo: true,
});
const doItem = (it) => ({
  nome: it.nome || "",
  cor: it.cor || COR_PADRAO,
  categoria: it.categoria || DEFAULT_ANALYTIC_CATEGORY,
  grafico: it.grafico !== false,
  ativo: it.ativo !== false,
});

// Linha da lista: alça de arraste + bolinha na cor do item + nome (+ categoria).
function LinhaItem({ item, selecionado, comCategoria, testidBase, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.nome });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors duration-150",
        isDragging && "relative z-10 shadow-md",
        selecionado
          ? "border-[#BBD9FF] bg-[#EAF3FF] dark:border-brand/50 dark:bg-brand/15"
          : "border-transparent hover:bg-accent/60"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Arraste para reordenar"
        aria-label={`Reordenar ${item.nome}`}
        data-testid={`${testidBase}-drag-${item.nome}`}
        className="cursor-grab touch-none text-muted-foreground opacity-50 transition-opacity hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        onClick={onSelect}
        data-testid={`${testidBase}-row-${item.nome}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.cor }} />
        <span
          className={cn("min-w-0 flex-1 truncate text-[13px] font-semibold", item.ativo === false && "opacity-60")}
          title={item.nome}
        >
          {item.nome}
        </span>
        {item.ativo === false && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-[1px] text-[9px] font-bold uppercase text-muted-foreground">
            Inativo
          </span>
        )}
        {comCategoria && (
          <span className="shrink-0 text-[11px] text-muted-foreground" title="Categoria Analítica">
            {item.categoria || DEFAULT_ANALYTIC_CATEGORY}
          </span>
        )}
      </button>
    </div>
  );
}

export function ListManagerModal({ tipo, open, onOpenChange, modoInicial = "editar", itemInicial = null }) {
  const cfg = configDoTipo(tipo);
  const testidBase = cfg.testid;
  const { lists, addListItem, updateListItem, removeListItem, reorderList, bids } = useData();
  const itens = useMemo(() => lists[tipo] || [], [lists, tipo]);

  // `selecionado` guarda o NOME do item em edição (chave estável da lista atual);
  // NOVO = painel em modo criação.
  const [selecionado, setSelecionado] = useState(null);
  const [form, setForm] = useState(vazio);
  const [salvando, setSalvando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);   // "excluir" | "emUso" | null
  const [excluindo, setExcluindo] = useState(false);
  const inicial = useRef(null);

  const carregar = useCallback((nome) => {
    if (nome === NOVO || !nome) {
      setSelecionado(NOVO);
      const f = vazio();
      setForm(f);
      inicial.current = JSON.stringify(f);
      return;
    }
    const it = itens.find((i) => i.nome === nome);
    if (!it) return;
    const f = doItem(it);
    setSelecionado(nome);
    setForm(f);
    inicial.current = JSON.stringify(f);
  }, [itens]);

  // Ao abrir: modo criação ("Adicionar…") ou edição do item clicado (lápis).
  useEffect(() => {
    if (!open) return;
    if (modoInicial === "novo") carregar(NOVO);
    else carregar(itemInicial || itens[0]?.nome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, modoInicial, itemInicial]);

  const criando = selecionado === NOVO;
  const alterado = inicial.current !== JSON.stringify(form);
  const nomeValido = form.nome.trim().length > 0;
  const duplicado = itens.some(
    (i) => i.nome.toLowerCase() === form.nome.trim().toLowerCase() && i.nome !== selecionado
  );
  // Item EM USO: alguma licitação aponta para ele (mesmo campo do backend).
  const emUso = useMemo(
    () => (criando ? 0 : (bids || []).filter((b) => b[cfg.campoBid] === selecionado).length),
    [bids, selecionado, criando, cfg.campoBid]
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const nomes = itens.map((i) => i.nome);
    reorderList(tipo, arrayMove(nomes, nomes.indexOf(active.id), nomes.indexOf(over.id)))
      .then(() => toast.success(cfg.ordem))
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail)));
  };

  // Só manda o que o tipo usa: categoria/grafico são exclusivos de `statuses`.
  const extrasDoForm = () => ({
    ativo: form.ativo,
    ...(cfg.comCategoria ? { categoria: form.categoria } : {}),
    ...(cfg.comGrafico ? { grafico: form.grafico } : {}),
  });

  const salvar = async () => {
    if (!nomeValido || duplicado || salvando) return;
    const nome = smartTitleCase(form.nome.trim());
    setSalvando(true);
    try {
      if (criando) {
        await addListItem(tipo, nome, form.cor, extrasDoForm());
        toast.success(cfg.criado);
        // Passa a editar o recém-criado. Não usa `carregar` porque a lista do
        // contexto ainda não está no closure desta renderização.
        const novo = { ...form, nome };
        setSelecionado(nome);
        setForm(novo);
        inicial.current = JSON.stringify(novo);
      } else {
        await updateListItem(tipo, selecionado, nome, form.cor, extrasDoForm());
        toast.success(cfg.atualizado);
        setSelecionado(nome);                 // o nome pode ter mudado
        inicial.current = JSON.stringify({ ...form, nome });
        setForm((f) => ({ ...f, nome }));
      }
    } catch (e) {
      // Mantém o modal aberto e os dados digitados.
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSalvando(false);
    }
  };

  const pedirExclusao = () => setConfirmar(emUso > 0 ? "emUso" : "excluir");

  const excluir = async () => {
    setExcluindo(true);
    try {
      await removeListItem(tipo, selecionado);
      toast.success(cfg.excluido);
      setConfirmar(null);
      carregar(itens.find((i) => i.nome !== selecionado)?.nome);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setExcluindo(false);
    }
  };

  // Item em uso não é apagado: o histórico das licitações seria perdido.
  // O caminho seguro é desativar — mesma ação do toggle "ativo".
  const desativar = async () => {
    setExcluindo(true);
    try {
      await updateListItem(tipo, selecionado, selecionado, form.cor, { ...extrasDoForm(), ativo: false });
      set("ativo", false);
      inicial.current = JSON.stringify({ ...form, ativo: false });
      toast.success(cfg.desativado);
      setConfirmar(null);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setExcluindo(false);
    }
  };

  const cancelar = () => {
    if (criando) carregar(itens[0]?.nome);
    else carregar(selecionado);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid={`${testidBase}-manager-modal`}
          className="max-h-[88vh] w-[min(1000px,92vw)] max-w-[92vw] gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="space-y-0 border-b border-border px-5 py-3.5 pr-12 text-left">
            {/* O "X" de fechar vem do próprio DialogContent (canto superior direito). */}
            <DialogTitle className="font-heading text-[17px] font-bold">{cfg.modalTitulo}</DialogTitle>
            <DialogDescription className="sr-only">
              Lista à esquerda e formulário de edição à direita.
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[calc(88vh-3.5rem)] min-h-0 grid-cols-1 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            {/* ---- Coluna esquerda: itens cadastrados ---- */}
            <div className="flex min-h-0 flex-col gap-2 border-b border-border p-4 md:border-b-0 md:border-r">
              <h3 className="text-[13px] font-bold text-foreground">{cfg.listaTitulo}</h3>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={itens.map((i) => i.nome)} strategy={verticalListSortingStrategy}>
                    {itens.map((it) => (
                      <LinhaItem
                        key={it.nome}
                        item={it}
                        selecionado={it.nome === selecionado}
                        comCategoria={cfg.comCategoria}
                        testidBase={testidBase}
                        onSelect={() => carregar(it.nome)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
              <button
                type="button"
                onClick={() => carregar(NOVO)}
                data-testid={`${testidBase}-novo`}
                className={cn(
                  "flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[12px] font-semibold transition-colors duration-150",
                  criando
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border text-foreground hover:border-brand/50 hover:text-brand"
                )}
              >
                <Plus size={14} /> {cfg.novo}
              </button>
            </div>

            {/* ---- Coluna direita: formulário ---- */}
            <div className="flex min-h-0 flex-col overflow-y-auto p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <h3 className="font-heading text-[15px] font-bold text-foreground">
                  {criando ? cfg.novo : cfg.editar}
                </h3>
                {!criando && (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={pedirExclusao}
                          data-testid={`${testidBase}-excluir`}
                          aria-label={cfg.excluirTooltip}
                          className="rounded-lg border border-alert/40 bg-alert/10 p-2 text-alert transition-colors hover:bg-alert/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alert/40"
                        >
                          <Trash2 size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{cfg.excluirTooltip}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`${testidBase}-nome`}>{cfg.campoNome}</Label>
                  <Input
                    id={`${testidBase}-nome`}
                    data-testid={`${testidBase}-nome`}
                    value={form.nome}
                    onChange={(e) => set("nome", e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && salvar()}
                    placeholder="Digite o nome"
                    aria-invalid={!nomeValido || duplicado}
                    className={cn((!nomeValido || duplicado) && "border-alert focus-visible:ring-alert")}
                  />
                  {duplicado && <p className="text-xs text-alert">{cfg.duplicado}</p>}
                </div>

                <div className={cn("grid gap-4", cfg.comCategoria && "sm:grid-cols-[auto_minmax(0,1fr)]")}>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${testidBase}-cor`}>Cor</Label>
                    <div className="flex h-10 w-fit items-center gap-2 rounded-lg border border-border px-2">
                      <input
                        id={`${testidBase}-cor`}
                        type="color"
                        data-testid={`${testidBase}-cor`}
                        value={form.cor}
                        onChange={(e) => set("cor", e.target.value)}
                        className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <span className="font-mono text-[11px] uppercase text-muted-foreground">{form.cor}</span>
                    </div>
                  </div>
                  {cfg.comCategoria && (
                    <div className="space-y-1.5">
                      <Label>Categoria Analítica</Label>
                      <Select value={form.categoria} onValueChange={(v) => set("categoria", v)}>
                        <SelectTrigger data-testid={`${testidBase}-categoria`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ANALYTIC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {cfg.comGrafico && (
                  <label className="flex cursor-pointer items-start gap-3">
                    <Switch
                      checked={form.grafico}
                      onCheckedChange={(v) => set("grafico", v)}
                      data-testid={`${testidBase}-toggle-grafico`}
                      aria-label="Exibir no gráfico de indicadores"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-foreground">Exibir no gráfico de indicadores</span>
                      <span className="block text-xs text-muted-foreground">
                        Este status será considerado no gráfico "Status das Licitações no Período".
                      </span>
                    </span>
                  </label>
                )}

                <label className="flex cursor-pointer items-start gap-3">
                  <Switch
                    checked={form.ativo}
                    onCheckedChange={(v) => set("ativo", v)}
                    data-testid={`${testidBase}-toggle-ativo`}
                    aria-label={cfg.ativoLabel}
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-foreground">{cfg.ativoLabel}</span>
                    <span className="block text-xs text-muted-foreground">Desative para ocultar sem excluir.</span>
                  </span>
                </label>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <Button variant="outline" onClick={cancelar} disabled={salvando} data-testid={`${testidBase}-cancelar`}>
                  Cancelar
                </Button>
                <Button
                  onClick={salvar}
                  data-testid={`${testidBase}-salvar`}
                  disabled={salvando || !nomeValido || duplicado || (!criando && !alterado)}
                  className="bg-brand hover:bg-brand-hover"
                >
                  {salvando && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmar === "excluir"}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={cfg.excluirTitulo}
        description={`Tem certeza de que deseja excluir ${cfg.artigo} "${selecionado}"?`}
        confirmLabel="Excluir"
        loading={excluindo}
        onConfirm={excluir}
        testid={`${testidBase}-confirm-excluir`}
      />
      <ConfirmDialog
        open={confirmar === "emUso"}
        onOpenChange={(o) => !o && setConfirmar(null)}
        title={cfg.emUsoTitulo}
        description={`${emUso} licitação(ões) usam "${selecionado}". Excluir deixaria esses registros sem referência válida — o caminho seguro é desativar: some das novas seleções e o histórico fica preservado.`}
        confirmLabel="Desativar"
        loadingLabel="Desativando..."
        loading={excluindo}
        onConfirm={desativar}
        testid={`${testidBase}-confirm-em-uso`}
      />
    </>
  );
}
