import {
  ArrowLeftRight, Banknote, Barcode, Briefcase, Building2, Car, CircleEllipsis, Coins, CreditCard, Fuel, Gavel,
  GraduationCap, Hammer, HandCoins, HardHat, HeartPulse, Home, Landmark, Laptop, Lightbulb, Megaphone, Package,
  Phone, PiggyBank, Plane, QrCode, Receipt, Scale, ShieldCheck, ShoppingCart, Store, Tag, Truck, Users, Utensils,
  Wallet, Wifi, Wrench, Zap,
} from "lucide-react";
import { fileUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

// Biblioteca de ícones do Financeiro (lucide-react — a mesma do resto do Vorcel).
// O cadastro guarda só o NOME; ícone desconhecido cai no genérico.
export const ICONS = {
  Tag, Coins, HandCoins, Landmark, Wallet, PiggyBank, Banknote, Receipt, QrCode, Barcode, CreditCard, ArrowLeftRight,
  CircleEllipsis, Package, ShoppingCart, Store, Truck, Car, Fuel, Plane, Hammer, Wrench, HardHat, Laptop, Wifi, Phone,
  Zap, Lightbulb, Home, Building2, Briefcase, Users, Utensils, HeartPulse, GraduationCap, Megaphone, Scale, Gavel,
  ShieldCheck,
};
export const ICON_LABELS = {
  Tag: "Etiqueta", Coins: "Moedas", HandCoins: "Recebimento", Landmark: "Órgão público", Wallet: "Carteira",
  PiggyBank: "Reserva", Banknote: "Dinheiro", Receipt: "Imposto / recibo", QrCode: "Pix", Barcode: "Boleto",
  CreditCard: "Cartão", ArrowLeftRight: "Transferência", CircleEllipsis: "Outro", Package: "Mercadoria",
  ShoppingCart: "Compras", Store: "Fornecedor", Truck: "Frete", Car: "Veículo", Fuel: "Combustível", Plane: "Viagem",
  Hammer: "Obra", Wrench: "Manutenção", HardHat: "Execução", Laptop: "Software", Wifi: "Internet", Phone: "Telefone",
  Zap: "Energia", Lightbulb: "Utilidades", Home: "Aluguel", Building2: "Empresa", Briefcase: "Administrativo",
  Users: "Pessoal", Utensils: "Alimentação", HeartPulse: "Saúde", GraduationCap: "Treinamento", Megaphone: "Marketing",
  Scale: "Jurídico", Gavel: "Licitação", ShieldCheck: "Seguro",
};

export function FinIcon({ name, size = 16, className, ...rest }) {
  const I = ICONS[name] || Tag;
  return <I size={size} className={className} {...rest} />;
}

// Monogramas de instituições (cor + sigla). Não são logos oficiais: servem de
// identificação visual quando o usuário não enviou a imagem da conta.
export const BANK_PRESETS = {
  bb: { nome: "Banco do Brasil", sigla: "BB", bg: "#FCE600", fg: "#1D3E8F" },
  itau: { nome: "Itaú", sigla: "itaú", bg: "#EC7000", fg: "#FFFFFF" },
  bradesco: { nome: "Bradesco", sigla: "B", bg: "#CC092F", fg: "#FFFFFF" },
  caixa: { nome: "Caixa", sigla: "CX", bg: "#005CA9", fg: "#FFFFFF" },
  santander: { nome: "Santander", sigla: "S", bg: "#EC0000", fg: "#FFFFFF" },
  nubank: { nome: "Nubank", sigla: "nu", bg: "#820AD1", fg: "#FFFFFF" },
  inter: { nome: "Inter", sigla: "in", bg: "#FF7A00", fg: "#FFFFFF" },
  sicoob: { nome: "Sicoob", sigla: "SC", bg: "#003641", fg: "#C9D200" },
  sicredi: { nome: "Sicredi", sigla: "SI", bg: "#3FA535", fg: "#FFFFFF" },
  c6: { nome: "C6 Bank", sigla: "C6", bg: "#1F1F1F", fg: "#FFFFFF" },
  btg: { nome: "BTG Pactual", sigla: "BTG", bg: "#0B2D5B", fg: "#FFFFFF" },
  mercadopago: { nome: "Mercado Pago", sigla: "MP", bg: "#00B1EA", fg: "#FFFFFF" },
  pagbank: { nome: "PagBank", sigla: "PB", bg: "#1BB99A", fg: "#FFFFFF" },
};

// Logo da conta/cartão: imagem enviada (R2) > monograma da instituição > ícone genérico.
export function BankLogo({ item, size = 36, className }) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  const fileId = item?.logo_file_id;
  if (fileId) {
    return <img src={fileUrl(fileId)} alt="" style={style} className={cn("shrink-0 object-cover", className)} />;
  }
  const p = BANK_PRESETS[item?.logo_preset || item?.instituicao];
  if (p) {
    return (
      <span style={{ ...style, background: p.bg, color: p.fg, fontSize: Math.max(9, size * (p.sigla.length > 2 ? 0.28 : 0.36)) }}
        className={cn("flex shrink-0 items-center justify-center font-bold tracking-tight", className)}>
        {p.sigla}
      </span>
    );
  }
  return (
    <span style={{ ...style, background: "var(--fin-primary-soft)", color: "var(--fin-primary)" }}
      className={cn("flex shrink-0 items-center justify-center", className)}>
      <Landmark size={size * 0.48} />
    </span>
  );
}

export function institutionName(key) {
  return BANK_PRESETS[key]?.nome || key || "";
}
