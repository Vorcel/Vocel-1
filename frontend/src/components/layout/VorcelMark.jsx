import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

// Símbolo oficial do Vorcel (V + documento + martelo), o MESMO nos dois módulos.
// Arquivo em public/ recortado do logo oficial (referências/vorcel-logo-icon-1024.png)
// só na área do símbolo — sem redesenho nem troca de cores. 256 px nítido em Retina.
export const VORCEL_SYMBOL = `${process.env.PUBLIC_URL || ""}/vorcel-symbol-256.png`;

export function VorcelMark({ className, alt = "Vorcel" }) {
  return (
    <img src={VORCEL_SYMBOL} alt={alt} draggable={false}
      className={cn("block shrink-0 rounded-lg object-contain", className)} />
  );
}

// Título da aba por módulo (sem subpágina): "Vorcel | Financeiro" em /financeiro,
// "Vorcel | Licitações" no resto. Atualiza a cada troca de rota.
export function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pathname.startsWith("/financeiro") ? "Vorcel | Financeiro" : "Vorcel | Licitações";
  }, [pathname]);
  return null;
}
