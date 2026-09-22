import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ListManagerModal } from "@/components/settings/ListManagerModal";
import { configDoTipo } from "@/components/settings/listTypes";
import { useData } from "@/context/DataContext";
import { hexToRgba } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Seção de uma lista de parâmetros (ref 5): card branco com o grid de itens em
// cartões pastel. Serve status, portais e modalidades — o que muda são os
// rótulos (listTypes.js). Toda a administração acontece no modal de
// gerenciamento; aqui só se lista e se abre o modal no modo certo.
// As cores dos cartões são DERIVADAS da cor cadastrada em cada item.
function CardItem({ item, tooltipEditar, onEdit, testidBase }) {
  const cor = item.cor || "#64748B";
  const inativo = item.ativo === false;
  return (
    <div
      data-testid={`${testidBase}-card-${item.nome}`}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-150",
        inativo && "opacity-60"
      )}
      style={{ backgroundColor: hexToRgba(cor, 0.09), borderColor: hexToRgba(cor, 0.35) }}
    >
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground" title={item.nome}>
        {item.nome}
      </span>
      {inativo && (
        <span className="shrink-0 rounded-full bg-background/70 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
          Inativo
        </span>
      )}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onEdit}
              data-testid={`${testidBase}-edit-${item.nome}`}
              aria-label={`${tooltipEditar}: ${item.nome}`}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/70 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <Pencil size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{tooltipEditar}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function ListSection({ tipo }) {
  const cfg = configDoTipo(tipo);
  const { lists } = useData();
  const itens = lists[tipo] || [];
  // `modal` guarda o modo de abertura: "novo" (botão Adicionar) ou o nome do
  // item clicado no lápis (abre já selecionado para edição).
  const [modal, setModal] = useState(null);
  const testidBase = cfg.testid;

  return (
    <div className="rounded-xl border border-border bg-card p-6" data-testid={`${testidBase}-section`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold text-foreground">{cfg.secao}</h3>
          <p className="text-sm text-muted-foreground">{cfg.descricao}</p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ modo: "novo" })}
          data-testid={`${testidBase}-adicionar`}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <Plus size={16} /> {cfg.adicionar}
        </button>
      </div>

      {itens.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nada cadastrado ainda. Use "{cfg.adicionar}" para criar o primeiro.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {itens.map((item) => (
            <CardItem
              key={item.nome}
              item={item}
              tooltipEditar={cfg.editarTooltip}
              testidBase={testidBase}
              onEdit={() => setModal({ modo: "editar", nome: item.nome })}
            />
          ))}
        </div>
      )}

      <ListManagerModal
        tipo={tipo}
        open={!!modal}
        onOpenChange={(o) => !o && setModal(null)}
        modoInicial={modal?.modo || "editar"}
        itemInicial={modal?.nome || null}
      />
    </div>
  );
}
