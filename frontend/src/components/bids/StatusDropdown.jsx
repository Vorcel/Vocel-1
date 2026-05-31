import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useData } from "@/context/DataContext";
import { colorStyles, findColor } from "@/lib/constants";

export const StatusDropdown = ({ bid }) => {
  const { lists, changeStatus } = useData();
  const s = colorStyles(findColor(lists.statuses, bid.status));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid={`status-trigger-${bid.id}`}
          style={s.badge}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-transform hover:scale-105"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={s.dot} />
          {bid.status}
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {(lists.statuses || []).map((st) => (
          <DropdownMenuItem
            key={st.nome}
            data-testid={`status-option-${bid.id}-${st.nome}`}
            onClick={() => st.nome !== bid.status && changeStatus(bid.id, st.nome)}
            className="gap-2"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: st.cor }} />
            {st.nome}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
