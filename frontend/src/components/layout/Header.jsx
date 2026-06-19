import { useNavigate } from "react-router-dom";
import { Settings, LogOut, User, Moon, Sun } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { fileUrl } from "@/lib/api";

export const Header = ({ title, subtitle, leftContent }) => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const initials = (user?.name || "U")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-card/80 px-6 shadow-sm backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
        {leftContent ? (
          leftContent
        ) : (
          <div className="min-w-0">
            <h1 className="truncate font-heading text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          data-testid="header-theme-toggle"
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Alternar tema"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          data-testid="header-settings"
          onClick={() => navigate("/configuracoes")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Configurações"
        >
          <Settings size={18} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button data-testid="header-avatar" className="ml-1 outline-none">
              <Avatar className="h-9 w-9 border border-border">
                {user?.avatar_url && <AvatarImage src={fileUrl(user.avatar_url)} alt={user?.name} />}
                <AvatarFallback className="bg-brand text-sm font-semibold text-white">{initials}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{user?.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="menu-profile" onClick={() => navigate("/configuracoes")}>
              <User size={16} className="mr-2" /> Meu Perfil
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="menu-theme" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={16} className="mr-2" /> : <Moon size={16} className="mr-2" />}
              {theme === "dark" ? "Tema claro" : "Tema escuro"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="menu-logout" onClick={logout} className="text-alert focus:text-alert">
              <LogOut size={16} className="mr-2" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
