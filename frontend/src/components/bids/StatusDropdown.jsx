import { ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useData } from "@/context/DataContext";
import { statusStyle } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const StatusDropdown = ({ bid }) => {
  const { lists, changeStatus } = useData();
  const s = statusStyle(bid.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid={`status-trigger-${bid.id}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-transform hover:scale-105",
            s.bg, s.text, s.ring
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
          {bid.status}
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {(lists.statuses || []).map((st) => {
          const ss = statusStyle(st);
          return (
            <DropdownMenuItem
              key={st}
              data-testid={`status-option-${bid.id}-${st}`}
              onClick={() => st !== bid.status && changeStatus(bid.id, st)}
              className="gap-2"
            >
              <span className={cn("h-2 w-2 rounded-full", ss.dot)} />
              {st}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
