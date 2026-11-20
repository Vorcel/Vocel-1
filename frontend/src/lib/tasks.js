// Tarefas — constantes e regras de apresentação (espelho de backend/tasks.py).
// A data final vem do backend como horário LOCAL de São Paulo (due_date +
// due_time), igual à data/hora da disputa das licitações: o Date é montado no
// fuso local do navegador, sem conversão UTC (nenhum deslocamento visual).

export const TASK_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
];
export const TASK_PRIORITIES = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
];
export const statusLabel = (v) => TASK_STATUSES.find((s) => s.value === v)?.label || v;
export const priorityLabel = (v) => TASK_PRIORITIES.find((p) => p.value === v)?.label || v;

export const HOME_SCOPES = [
  { key: "todos", label: "Todos" },
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "proximos2", label: "Próximos 2 dias" },
  { key: "semana", label: "Esta semana" },
];
export const PAGE_SCOPES = [
  { key: "todas", label: "Todas" },
  { key: "todos", label: "Todos" },
  { key: "hoje", label: "Hoje" },
  { key: "amanha", label: "Amanhã" },
  { key: "proximos", label: "Próximos dias" },
  { key: "semana", label: "Esta semana" },
];

export const taskDueDate = (t) => {
  if (!t?.due_date) return null;
  const d = new Date(`${t.due_date}T${t.due_time || "23:59"}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "25/11/2026 17:00" — a data/hora objetiva cadastrada (coluna Data final).
export const formatDueFull = (t) => {
  if (!t?.due_date) return "—";
  const [y, m, d] = t.due_date.split("-");
  return `${d}/${m}/${y} ${t.due_time || ""}`.trim();
};

// 25 min · 1h40 · 3h · 2 dias
export const formatSpan = (ms) => {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${Math.max(min, 1)} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${pad(m)}` : `${h}h`;
  }
  const days = Math.floor(min / (24 * 60));
  return days === 1 ? "1 dia" : `${days} dias`;
};

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

// Indicador dinâmico da coluna Prazo (recalculado no navegador a partir de due_*).
// tone: neutral | near | soft | warn | late — a cor fica SÓ no indicador.
//   > 6h ................ neutral  ("Hoje, 17:00" / "Amanhã, 10:00" / "25/11, 17:00")
//   6h–2h ............... near     (aviso discreto com relógio: "Prazo próximo · 4h10")
//   2h–30min ............ soft     (amarelo suave: "Faltam 1h40")
//   < 30 min ............ warn     (laranja + pulse suave: "Faltam 25 min")
//   vencida ............. late     (vermelho: "Atrasada há 42 min")
//   Prioridade Alta antecipa o amarelo suave para 4h.
export function deadlineInfo(task, now = new Date()) {
  if (task?.status === "concluida") return { tone: "done", text: "—" };
  const due = taskDueDate(task);
  if (!due) return { tone: "neutral", text: "—" };
  const diff = due - now;
  if (diff < 0) return { tone: "late", text: `Atrasada há ${formatSpan(-diff)}` };
  if (diff < 30 * MIN) return { tone: "warn", text: `Faltam ${formatSpan(diff)}`, pulse: true };
  if (diff < 2 * HOUR) return { tone: "soft", text: `Faltam ${formatSpan(diff)}` };
  if (task.priority === "alta" && diff < 4 * HOUR) return { tone: "soft", text: `Faltam ${formatSpan(diff)}` };
  if (diff < 6 * HOUR) return { tone: "near", text: `Prazo próximo · ${formatSpan(diff)}` };
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const hhmm = task.due_time || "";
  if (task.due_date === today) return { tone: "neutral", text: `Hoje, ${hhmm}` };
  if (task.due_date === tomorrow) return { tone: "neutral", text: `Amanhã, ${hhmm}` };
  const [, m, d] = task.due_date.split("-");
  return { tone: "neutral", text: `${d}/${m}, ${hhmm}` };
}

// ---- Tag do pregão vinculado: "PE 039/2026" (modalidade real abreviada + número).
const strip = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Siglas usuais; modalidade nova/desconhecida cai nas iniciais das palavras.
const MODALIDADE_SIGLAS = {
  "pregao eletronico": "PE", "pregao presencial": "PP", "pregao": "PG",
  "concorrencia eletronica": "CE", "concorrencia presencial": "CP", "concorrencia": "CC",
  "tomada de precos": "TP", "convite": "CV", "leilao": "LE", "leilao eletronico": "LE",
  "dispensa": "DL", "dispensa de licitacao": "DL", "dispensa eletronica": "DE",
  "inexigibilidade": "IN", "credenciamento": "CR", "dialogo competitivo": "DC", "concurso": "CO",
};
const STOP = new Set(["de", "da", "do", "das", "dos", "e"]);
export function modalidadeSigla(modalidade) {
  const k = strip(modalidade);
  if (!k) return "";
  if (MODALIDADE_SIGLAS[k]) return MODALIDADE_SIGLAS[k];
  const words = k.split(/\s+/).filter((w) => w && !STOP.has(w));
  if (words.length >= 2) return words.map((w) => w[0]).join("").toUpperCase().slice(0, 3);
  return (words[0] || "").slice(0, 3).toUpperCase();
}
// "39/2026" -> "039/2026" (padrão do pregão); outros formatos ficam como estão.
export const formatPregaoNumero = (p) => {
  const v = String(p || "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{4})$/);
  return m ? `${m[1].padStart(3, "0")}/${m[2]}` : v;
};
export function pregaoTag(task) {
  if (!task?.bid_id || !task.bid_pregao) return null;
  const sigla = modalidadeSigla(task.bid_modalidade);
  return [sigla, formatPregaoNumero(task.bid_pregao)].filter(Boolean).join(" ");
}

export const initialOf = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";

// Cor do avatar do responsável: estável por id (mesma pessoa = mesma cor).
const AVATAR_COLORS = ["#7C3AED", "#2563EB", "#0891B2", "#059669", "#D97706", "#DB2777", "#4F46E5", "#0C7B93"];
export const avatarColor = (id) => {
  const s = String(id || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
