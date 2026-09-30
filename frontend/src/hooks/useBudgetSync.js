// Sincronização colaborativa da Planilha de Orçamento (modo licitação).
//
// - Cada edição vira uma operação GRANULAR (patch de campos de UMA linha, add,
//   delete, reorder) enviada numa fila sequencial — nunca a planilha inteira.
// - Last-write-wins POR CAMPO, decidido pelo backend: toda operação devolve a
//   `revision` em que foi aplicada; o cliente guarda a revisão de cada campo e só
//   aceita um valor remoto mais novo que o que já tem.
// - Campo com edição local pendente não é sobrescrito por evento remoto: o valor
//   remoto fica "adiado" e só é aplicado se a revisão dele for maior que a da nossa
//   gravação (ou seja, se ele venceu no servidor).
// - Eventos remotos só mexem no estado (setRows) — não passam pela fila, então
//   nunca geram novo salvamento (sem loop). Eventos da própria sessão (mesmo
//   client_id) são ignorados.
// - Campos calculados NÃO trafegam: são recalculados por calc.js (fonte única) a
//   partir das entradas sincronizadas. O `summary` do backend é calculado pelo mesmo
//   motor sobre as linhas autoritativas devolvidas pela operação.
// - WebSocket com reconexão (backoff) + ressincronização por GET ao reconectar.
import { useEffect, useRef, useState } from "react";
import api, { API, formatApiError } from "@/lib/api";
import { computeTotals } from "@/lib/calc";
import { toast } from "sonner";

// Linhas vindas do backend -> estado da tabela (mesma normalização de sempre).
export const hydrateRows = (rows) =>
  (rows || []).map((r, i) => ({ _id: `s${i}`, mode: r.valor_venda ? "venda" : "margem", ...r }));

const randomId = () =>
  (window.crypto?.randomUUID ? window.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
// Id estável da linha (gerado no cliente, único entre sessões).
export const newRowId = () => `r${randomId()}`;

const fkey = (rowId, f) => `${rowId}|${f}`;
const SUMMARY_DELAY = 800;
const MAX_RETRY_DELAY = 15000;
const PING_EVERY = 25000;

const isRetryable = (e) => !e.response || e.response.status >= 500 || [408, 409, 429].includes(e.response.status);
const isRowGone = (e) => e.response?.status === 404 && e.response?.data?.detail?.code === "row_not_found";

export function useBudgetSync({ bidId, enabled, rows, setRows }) {
  const [clientId] = useState(randomId);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [started, setStarted] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = {
      queue: [], inflight: null, running: false, seq: 0,
      localSeq: new Map(),   // campo -> seq da última edição local ainda não confirmada
      fieldRev: new Map(),   // campo -> revisão do valor que está na tela
      deferred: new Map(),   // campo -> { value, rev } remoto recebido durante edição pendente
      pendingAdds: new Set(), pendingDeletes: new Set(),
      baseRev: 0, revision: 0, lastAck: null,
      summaryTimer: null, savedTimer: null, wake: null,
      unmounted: false, resyncing: false, resyncAgain: false,
    };
  }
  const st = ref.current;
  const base = `/bids/${bidId}/budget`;

  const applyToRow = (rowId, patch) =>
    setRows((prev) => prev.map((r) => (r._id === rowId ? { ...r, ...patch } : r)));

  const clearRowKeys = (rowId) => {
    const pre = `${rowId}|`;
    [st.localSeq, st.fieldRev, st.deferred].forEach((m) => {
      [...m.keys()].forEach((k) => { if (k.startsWith(pre)) m.delete(k); });
    });
  };

  // Item excluído (por outra sessão ou já inexistente no servidor): some da tela,
  // descarta operações ainda não enviadas para ele e nunca o recria.
  const dropRow = (rowId, notify) => {
    st.queue = st.queue.filter((op) => op === st.inflight || (op.rowId !== rowId && op.row?._id !== rowId));
    st.pendingAdds.delete(rowId);
    clearRowKeys(rowId);
    const wasVisible = rowsRef.current.some((r) => r._id === rowId);
    setRows((prev) => prev.filter((r) => r._id !== rowId));
    if (notify && wasVisible) toast.warning("Um item que você estava editando foi excluído em outra sessão.");
  };

  // ---------------------------------------------------------------- summary
  const pushSummary = async () => {
    if (st.queue.length || !st.lastAck) return; // fila ainda andando: reagenda ao esvaziar
    const { revision, rows: srvRows } = st.lastAck;
    st.lastAck = null;
    if (revision < st.revision) return; // houve operação mais nova; quem a fez grava o summary
    try {
      await api.put(`${base}/summary`, { revision, summary: computeTotals(hydrateRows(srvRows)) });
    } catch { /* o próximo salvamento (ou a próxima abertura) recalcula */ }
  };
  const scheduleSummary = () => {
    clearTimeout(st.summaryTimer);
    st.summaryTimer = setTimeout(pushSummary, SUMMARY_DELAY);
  };
  // Summary atrás das linhas (ex.: aba fechada antes de gravar): recalcula ao abrir.
  const healSummary = (data) => {
    if ((data.revision || 0) > 0 && data.summary_revision !== data.revision) {
      st.lastAck = { revision: data.revision, rows: data.rows || [] };
      scheduleSummary();
    }
  };

  // ---------------------------------------------------------------- fila de operações
  const send = (op) => {
    switch (op.type) {
      case "patch": return api.patch(`${base}/rows/${encodeURIComponent(op.rowId)}`, { fields: op.fields, client_id: clientId });
      case "add": return api.post(`${base}/rows`, { row: op.row, client_id: clientId });
      case "delete": return api.delete(`${base}/rows/${encodeURIComponent(op.rowId)}`, { params: { client_id: clientId } });
      case "order": return api.put(`${base}/order`, { order: op.order, client_id: clientId });
      default: return Promise.resolve({ data: {} });
    }
  };

  const settleField = (rowId, f, sq, rev) => {
    const k = fkey(rowId, f);
    const d = st.deferred.get(k);
    if (st.localSeq.get(k) !== sq) { // há edição local mais nova na fila: ela decide
      if (d && d.rev < rev) st.deferred.delete(k);
      return;
    }
    st.localSeq.delete(k);
    st.deferred.delete(k);
    st.fieldRev.set(k, Math.max(st.fieldRev.get(k) ?? 0, rev));
    if (d && d.rev > rev) { // outra sessão gravou este campo DEPOIS de nós: ela venceu
      st.fieldRev.set(k, d.rev);
      applyToRow(rowId, { [f]: d.value });
    }
  };

  const onAck = (op, data) => {
    const rev = data?.revision ?? 0;
    st.revision = Math.max(st.revision, rev);
    if (Array.isArray(data?.rows)) st.lastAck = { revision: rev, rows: data.rows };
    if (op.type === "patch") Object.keys(op.fields).forEach((f) => settleField(op.rowId, f, op.seqs[f], rev));
    if (op.type === "add") {
      st.pendingAdds.delete(op.row._id);
      Object.keys(op.row).forEach((f) => {
        const k = fkey(op.row._id, f);
        if (!st.localSeq.has(k)) st.fieldRev.set(k, Math.max(st.fieldRev.get(k) ?? 0, rev));
      });
    }
    if (op.type === "delete") st.pendingDeletes.delete(op.rowId);
  };

  const onFail = (op, e) => {
    if (isRowGone(e)) { dropRow(op.rowId, true); return; }
    if (op.type === "patch") Object.keys(op.fields).forEach((f) => {
      const k = fkey(op.rowId, f);
      if (st.localSeq.get(k) === op.seqs[f]) st.localSeq.delete(k);
    });
    if (op.type === "add") st.pendingAdds.delete(op.row._id);
    if (op.type === "delete") st.pendingDeletes.delete(op.rowId);
    toast.error(formatApiError(e.response?.data?.detail));
    resync(); // volta para o estado real do servidor
  };

  const sleep = (ms) => new Promise((res) => { st.wake = res; setTimeout(res, ms); });

  const pump = async () => {
    if (st.running) return;
    st.running = true;
    let delay = 1000;
    let failures = 0;
    while (st.queue.length) {
      const op = st.queue[0];
      st.inflight = op;
      setSaveState("saving");
      try {
        const { data } = await send(op);
        st.inflight = null;
        st.queue.shift();
        delay = 1000; failures = 0;
        onAck(op, data);
      } catch (e) {
        st.inflight = null;
        if (isRetryable(e) && !(st.unmounted && failures >= 5)) {
          // Sem rede / backend fora: NÃO finge que salvou; mantém o valor local e tenta de novo.
          failures += 1;
          setSaveState("error");
          await sleep(delay);
          delay = Math.min(delay * 2, MAX_RETRY_DELAY);
          continue;
        }
        st.queue.shift();
        onFail(op, e);
      }
    }
    st.running = false;
    setSaveState("saved");
    clearTimeout(st.savedTimer);
    st.savedTimer = setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1600);
    scheduleSummary();
  };

  const enqueue = (op) => {
    const sq = ++st.seq;
    if (op.type === "patch") {
      op.seqs = {};
      Object.keys(op.fields).forEach((f) => { st.localSeq.set(fkey(op.rowId, f), sq); op.seqs[f] = sq; });
      // Coalesce: edições seguidas na mesma linha, ainda não enviadas, viram UMA requisição.
      const last = st.queue[st.queue.length - 1];
      if (last && last !== st.inflight && last.type === "patch" && last.rowId === op.rowId) {
        Object.assign(last.fields, op.fields);
        Object.assign(last.seqs, op.seqs);
        pump();
        return;
      }
    }
    if (op.type === "add") st.pendingAdds.add(op.row._id);
    if (op.type === "delete") {
      st.pendingDeletes.add(op.rowId);
      st.queue = st.queue.filter((o) => o === st.inflight || o.type !== "patch" || o.rowId !== op.rowId);
      clearRowKeys(op.rowId);
    }
    st.queue.push(op);
    pump();
  };

  // ---------------------------------------------------------------- API para a página
  // `patch` = campos de ENTRADA alterados pelo usuário. Patches de um campo só são
  // descartados se o valor não mudou; os de vários campos (venda/margem/mode) vão
  // juntos para não desacoplar campos que dependem um do outro.
  const patchRow = (rowId, patch) => {
    const cur = rowsRef.current.find((r) => r._id === rowId);
    if (!cur) return;
    const keys = Object.keys(patch);
    if (keys.length === 1 && cur[keys[0]] === patch[keys[0]]) return;
    applyToRow(rowId, patch);
    enqueue({ type: "patch", rowId, fields: { ...patch } });
  };
  const addRow = (row) => {
    setRows((prev) => [...prev, row]);
    enqueue({ type: "add", row: { ...row } });
  };
  const deleteRow = (rowId) => {
    setRows((prev) => prev.filter((r) => r._id !== rowId));
    enqueue({ type: "delete", rowId });
  };
  const reorder = (order) => enqueue({ type: "order", order });

  // Estado inicial carregado pela página (GET) -> liga a sincronização.
  const start = (data) => {
    st.baseRev = data.revision || 0;
    st.revision = Math.max(st.revision, st.baseRev);
    healSummary(data);
    setStarted(true);
  };

  // ---------------------------------------------------------------- ressincronização
  // Busca o estado atual e reconcilia: servidor é a verdade, exceto campos com
  // edição local ainda não confirmada (serão gravados e vencerão pelo LWW) e linhas
  // adicionadas localmente ainda em envio.
  const resync = async () => {
    if (st.resyncing) { st.resyncAgain = true; return; }
    st.resyncing = true;
    try {
      const { data } = await api.get(base);
      const server = hydrateRows(data.rows);
      const rev = data.revision || 0;
      const local = rowsRef.current;
      const localById = new Map(local.map((r) => [r._id, r]));
      const pendingByRow = new Map();
      st.localSeq.forEach((_, k) => {
        const [rowId, f] = k.split("|");
        if (!pendingByRow.has(rowId)) pendingByRow.set(rowId, []);
        pendingByRow.get(rowId).push(f);
      });
      const merged = server.filter((r) => !st.pendingDeletes.has(r._id)).map((r) => {
        const fs = pendingByRow.get(r._id);
        const lr = localById.get(r._id);
        if (!fs || !lr) return r;
        const o = { ...r };
        fs.forEach((f) => {
          // Se nossa gravação perder para a do servidor (revisão menor), este é o valor que vale.
          const k = fkey(r._id, f);
          const d = st.deferred.get(k);
          if (!d || d.rev < rev) st.deferred.set(k, { value: r[f], rev });
          o[f] = lr[f];
        });
        return o;
      });
      const ids = new Set(merged.map((r) => r._id));
      local.forEach((r) => { if (st.pendingAdds.has(r._id) && !ids.has(r._id)) merged.push(r); });
      st.baseRev = rev;
      st.revision = Math.max(st.revision, rev);
      st.fieldRev.clear();
      setRows(merged);
      healSummary(data);
    } catch { /* tenta de novo na próxima reconexão */ }
    finally {
      st.resyncing = false;
      if (st.resyncAgain) { st.resyncAgain = false; resync(); }
    }
  };

  // ---------------------------------------------------------------- eventos remotos
  const handleEvent = (ev) => {
    if (typeof ev.revision !== "number") return;
    const own = ev.source_client_id && ev.source_client_id === clientId;
    st.revision = Math.max(st.revision, ev.revision);
    if (own) return; // eco da própria sessão (já aplicado localmente)
    switch (ev.type) {
      case "budget_row_updated": {
        if (!rowsRef.current.some((r) => r._id === ev.row_id)) {
          if (!st.pendingDeletes.has(ev.row_id)) resync(); // linha que ainda não conhecemos
          return;
        }
        const patch = {};
        Object.entries(ev.fields || {}).forEach(([f, v]) => {
          const k = fkey(ev.row_id, f);
          if ((st.fieldRev.get(k) ?? st.baseRev) >= ev.revision) return; // evento velho
          if (st.localSeq.has(k)) {
            const d = st.deferred.get(k);
            if (!d || d.rev < ev.revision) st.deferred.set(k, { value: v, rev: ev.revision });
            return;
          }
          st.fieldRev.set(k, ev.revision);
          patch[f] = v;
        });
        if (Object.keys(patch).length) applyToRow(ev.row_id, patch);
        break;
      }
      case "budget_row_added": {
        if (st.baseRev >= ev.revision || !ev.row?._id) return;
        const [row] = hydrateRows([ev.row]);
        Object.keys(row).forEach((f) => st.fieldRev.set(fkey(row._id, f), ev.revision));
        setRows((prev) => (prev.some((r) => r._id === row._id) ? prev : [...prev, row]));
        break;
      }
      case "budget_row_deleted": {
        if (st.pendingDeletes.has(ev.row_id)) return;
        const hadPending = [...st.localSeq.keys()].some((k) => k.startsWith(`${ev.row_id}|`));
        dropRow(ev.row_id, hadPending);
        break;
      }
      case "budget_rows_reordered": {
        if (st.baseRev >= ev.revision) return;
        const pos = new Map((ev.order || []).map((id, i) => [id, i]));
        setRows((prev) => {
          const known = prev.filter((r) => pos.has(r._id)).sort((a, b) => pos.get(a._id) - pos.get(b._id));
          return [...known, ...prev.filter((r) => !pos.has(r._id))];
        });
        break;
      }
      case "budget_replaced":
        resync();
        break;
      default:
    }
  };

  // Guardar os handlers mais recentes para o WebSocket (evita closures velhas).
  const handlers = useRef({});
  handlers.current = { handleEvent, resync, wake: () => st.wake?.() };

  // ---------------------------------------------------------------- WebSocket
  useEffect(() => {
    if (!enabled || !started || !bidId) return undefined;
    const url = `${API.replace(/^http/, "ws")}/ws/budget/${bidId}`;
    let ws = null;
    let closed = false;
    let attempt = 0;
    let first = true;
    let pingTimer = null;
    let retryTimer = null;

    const connect = () => {
      clearTimeout(retryTimer);
      ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("token") }));
      ws.onmessage = (m) => {
        let ev;
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "pong") return;
        if (ev.type === "ready") {
          attempt = 0;
          // Reconexão (ou mudanças entre o GET e a entrada na sala): não confiar no
          // estado local — ressincroniza com o servidor.
          if (!first || ev.revision > ref.current.revision) handlers.current.resync();
          first = false;
          handlers.current.wake(); // fila esperando retry: tenta já
          clearInterval(pingTimer);
          pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('{"type":"ping"}'); }, PING_EVERY);
          return;
        }
        handlers.current.handleEvent(ev);
      };
      ws.onclose = (e) => {
        clearInterval(pingTimer);
        if (closed) return;
        if (e.code === 4401 || e.code === 4404) return; // sem acesso: não insiste
        const wait = Math.min(1000 * 2 ** attempt, 20000) + Math.random() * 500;
        attempt += 1;
        retryTimer = setTimeout(connect, wait);
      };
    };
    connect();

    const onOnline = () => {
      handlers.current.wake();
      if (ws && ws.readyState !== 0 && ws.readyState !== 1) { attempt = 0; connect(); }
    };
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      if (ws) ws.close(1000);
    };
  }, [enabled, started, bidId]);

  // Sair da página com alteração ainda não gravada: pede confirmação ao navegador.
  useEffect(() => {
    if (!enabled) return undefined;
    const onBeforeUnload = (e) => {
      if (ref.current.queue.length) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled]);

  // Ao desmontar, a fila continua até esvaziar (não perde a última edição ao
  // navegar para outra página); só para de insistir se continuar sem rede.
  useEffect(() => {
    const cur = ref.current;
    cur.unmounted = false;
    return () => { cur.unmounted = true; };
  }, []);

  return { saveState, start, patchRow, addRow, deleteRow, reorder };
}
