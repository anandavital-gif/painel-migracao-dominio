/**
 * Painel de Controle — Migração TOTVS Protheus → Domínio Sistemas
 * Grupo Paraná
 *
 * Arquitetura (decisão de 23/07/2026): a fonte da verdade é uma planilha
 * Google Sheets ("Controle de Migração..."), publicada na web como CSV.
 * Este painel só LÊ essa planilha (fetch do CSV publicado) e renderiza
 * KPIs, gráficos por departamento, quadro Kanban e tabela completa —
 * ele não escreve nada de volta. Quem for mudar a fase de um cliente edita
 * direto na planilha (link "Editar na planilha" em cada card); o histórico
 * de alterações vira o Histórico de versões nativo do Google Sheets, não
 * um campo manual aqui.
 *
 * Sem frameworks, sem build step: só para abrir e funcionar.
 */
(() => {
  "use strict";

  // Precisam bater com FASES/DEPARTAMENTOS_POSSIVEIS/PRIORIDADES em
  // scripts/importar_dominio.py — se mudar lá, muda aqui também.
  const FASES = [
    "Não Iniciado", "Parametrização", "Migração de Dados",
    "Testes/Homologação", "Go-live", "Estabilização",
  ];
  const FASE_NAO_APLICAVEL = "Não Aplicável";
  const DEPARTAMENTOS = [
    "Fiscal", "Contabilidade", "Departamento Pessoal",
    "Onvio Processos", "Kolossus Auditor",
  ];
  const PRIORIDADES = ["Alta", "Média", "Baixa"];
  const REGIMES = ["Simples Nacional", "Lucro Real", "Lucro Presumido", "Pessoa Física"];

  const STATUS_LABEL = {
    good: "No prazo",
    good_done: "Concluído",
    warning: "Atenção",
    critical: "Atrasado",
    neutral: "Sem data definida",
    na: "Não aplicável",
  };

  const STATE = {
    clientes: [],       // montado a partir das linhas da planilha
    lastFetch: null,
    filters: {
      dept: "__all__",
      regime: "__all__",
      search: "",
      cidade: "",
      prioridade: "",
      status: "",
    },
    view: "kanban",     // 'kanban' | 'tabela'
    chartView: "barras", // 'barras' | 'pizza'
    boardCollapsed: false, // minimiza o Kanban/Tabela sem perder filtros e gráficos acima
    tableSort: { col: "nome", dir: 1 },
    detail: null,        // { clienteId, dep } aberto no modal (somente leitura)
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function fmtDateBR(iso) {
    if (!iso) return "—";
    const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("pt-BR");
  }

  function fmtDateTimeBR(d) {
    if (!d) return "—";
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function depColorVar(dep) {
    if (dep === "Fiscal") return "var(--dep-fiscal)";
    if (dep === "Contabilidade") return "var(--dep-contabilidade)";
    if (dep === "Departamento Pessoal") return "var(--dep-dp)";
    if (dep === "Onvio Processos") return "var(--dep-onvio)";
    if (dep === "Kolossus Auditor") return "var(--dep-kolossus)";
    return "var(--text-muted)";
  }

  // Paleta categórica para o gráfico de pizza (fase por posição de cor, não
  // por matiz sequencial): baseada na paleta Okabe-Ito, validada para
  // daltonismo (protanopia/deuteranopia/tritanopia) — diferente da rampa de
  // azul só que reprovava com muitos degraus. Mesmo assim, a fase nunca fica
  // só na cor: toda fatia tem rótulo com texto + contagem na legenda ao lado.
  const FASE_PIE_COLORS = [
    "#9a9a9a", // Não Iniciado
    "#56B4E9", // Parametrização
    "#0072B2", // Migração de Dados
    "#E69F00", // Testes/Homologação
    "#009E73", // Go-live
    "#CC79A7", // Estabilização
  ];
  function faseCorPizza(fase) {
    const i = FASES.indexOf(fase);
    return i >= 0 ? FASE_PIE_COLORS[i % FASE_PIE_COLORS.length] : "#9a9a9a";
  }

  // ------------------------------------------------------------------
  // CSV parsing (RFC4180 simples: aspas, vírgulas e quebras de linha
  // dentro de campo) — sem dependência externa.
  // ------------------------------------------------------------------
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], next = text[i + 1];
      if (inQuotes) {
        if (c === '"' && next === '"') { field += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { field += c; }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && next === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map((h) => h.trim());
    return rows.slice(1)
      .filter((r) => r.some((v) => v !== ""))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  }

  function inferTipoNI(ni) {
    const digits = (ni || "").replace(/[^0-9]/g, "");
    if (ni.includes("*")) return "cpf"; // mascarado (ver gerar_dados.py)
    return digits.length === 14 ? "cnpj" : "cpf";
  }

  // Agrupa as linhas achatadas (cliente x departamento) da planilha na
  // mesma estrutura {clientes:[{..., departamentos:{dep: track}}]} que o
  // resto do painel já sabe renderizar.
  function transformRows(rows) {
    const porCliente = new Map();
    for (const r of rows) {
      const nome = r["Cliente"];
      if (!nome) continue;
      if (!porCliente.has(nome)) {
        porCliente.set(nome, {
          id: nome,
          nome,
          ni: r["CPF/CNPJ/CAEPF"] || "",
          tipoNI: inferTipoNI(r["CPF/CNPJ/CAEPF"] || ""),
          cidade: r["Cidade"] || "",
          estado: r["UF"] || "",
          regimeTributario: r["Regime Tributário"] || "",
          departamentos: {},
        });
      }
      const cliente = porCliente.get(nome);
      const dep = r["Departamento"];
      if (!dep) continue;
      cliente.departamentos[dep] = {
        faseAtual: r["Fase Atual"] || FASES[0],
        responsavel: r["Responsável"] || "",
        prioridade: r["Prioridade"] || "Média",
        dataConclusaoPrevista: r["Conclusão Prevista"] || null,
        observacoes: r["Observações"] || "",
      };
    }
    return Array.from(porCliente.values());
  }

  // ------------------------------------------------------------------
  // Carregamento
  // ------------------------------------------------------------------
  async function loadData() {
    // Uma versão "instantânea" do painel (ex.: pré-visualização) pode embutir
    // os dados direto na página via window.__EMBEDDED_DATA__, dispensando
    // fetch — usado pelo build de snapshot standalone (ver scripts/).
    if (window.__EMBEDDED_DATA__) {
      STATE.clientes = window.__EMBEDDED_DATA__;
      STATE.lastFetch = new Date();
      return;
    }
    const url = window.APP_CONFIG && window.APP_CONFIG.sheetCsvUrl;
    if (!url) {
      throw new Error(
        "js/config.js ainda não tem sheetCsvUrl preenchido. Publique a planilha na web " +
        "(Arquivo > Compartilhar > Publicar na web) e cole o link CSV em config.js."
      );
    }
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(`Não foi possível carregar a planilha publicada (HTTP ${res.status}).`);
    const text = await res.text();
    STATE.clientes = transformRows(parseCsv(text));
    STATE.lastFetch = new Date();
  }

  // ------------------------------------------------------------------
  // Status de prazo de uma trilha (cliente + departamento)
  // ------------------------------------------------------------------
  function trackStatus(track) {
    if (track.faseAtual === FASE_NAO_APLICAVEL) {
      return { key: "na", label: STATUS_LABEL.na };
    }
    if (track.faseAtual === "Estabilização" || track.faseAtual === "Go-live") {
      return { key: "good", cls: "good", label: STATUS_LABEL.good_done };
    }
    if (track.dataConclusaoPrevista) {
      const hoje = new Date(todayStr() + "T00:00:00");
      const prevista = new Date(track.dataConclusaoPrevista + "T00:00:00");
      if (!isNaN(prevista)) {
        const diffDias = Math.round((prevista - hoje) / 86400000);
        if (diffDias < 0) return { key: "critical", cls: "critical", label: STATUS_LABEL.critical };
        if (diffDias <= 7) return { key: "warning", cls: "warning", label: STATUS_LABEL.warning };
        return { key: "good", cls: "good", label: STATUS_LABEL.good };
      }
    }
    return { key: "neutral", cls: "neutral", label: STATUS_LABEL.neutral };
  }

  function trackProgress01(track) {
    if (track.faseAtual === FASE_NAO_APLICAVEL) return null;
    const idx = FASES.indexOf(track.faseAtual);
    return idx < 0 ? 0 : idx / (FASES.length - 1);
  }

  // ------------------------------------------------------------------
  // Enumeração filtrada de trilhas (cliente + departamento)
  // ------------------------------------------------------------------
  function normalize(s) {
    return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function allTracks({ ignoreDeptTab = false } = {}) {
    const f = STATE.filters;
    const out = [];
    for (const cliente of STATE.clientes) {
      if (f.search) {
        const hay = normalize(cliente.nome + " " + cliente.ni + " " + cliente.cidade);
        if (!hay.includes(normalize(f.search))) continue;
      }
      if (f.cidade && cliente.cidade !== f.cidade) continue;
      if (f.regime !== "__all__" && (cliente.regimeTributario || "") !== f.regime) continue;

      for (const dep of Object.keys(cliente.departamentos || {})) {
        if (!ignoreDeptTab && f.dept !== "__all__" && dep !== f.dept) continue;
        const track = cliente.departamentos[dep];
        if (f.prioridade && track.prioridade !== f.prioridade) continue;
        if (f.status) {
          const st = trackStatus(track);
          if (st.key !== f.status) continue;
        }
        out.push({ cliente, dep, track });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  // KPIs
  // ------------------------------------------------------------------
  function renderKpis() {
    const tracks = allTracks();
    const clientesUnicos = new Set(tracks.map((t) => t.cliente.id)).size;
    const aplicaveis = tracks.filter((t) => t.track.faseAtual !== FASE_NAO_APLICAVEL);
    const concluidos = aplicaveis.filter((t) => t.track.faseAtual === "Estabilização").length;
    const atrasados = aplicaveis.filter((t) => trackStatus(t.track).key === "critical").length;
    const naoIniciados = aplicaveis.filter((t) => t.track.faseAtual === "Não Iniciado").length;
    const pctGeral = aplicaveis.length
      ? Math.round(100 * aplicaveis.reduce((s, t) => s + trackProgress01(t.track), 0) / aplicaveis.length)
      : 0;

    const tiles = [
      { label: "Clientes na visão atual", value: clientesUnicos, sub: `${aplicaveis.length} trilha(s) aplicável(is)` },
      { label: "% concluído (médio)", value: pctGeral + "%", sub: "média ponderada pela fase de cada trilha" },
      { label: "Trilhas atrasadas", value: atrasados, sub: "prazo previsto já vencido", cls: atrasados > 0 ? "status-critical" : "" },
      { label: "Concluídas (Estabilização)", value: concluidos, sub: "", cls: concluidos > 0 ? "status-good" : "" },
      { label: "Não iniciadas", value: naoIniciados, sub: "" },
    ];

    $("#kpiRow").innerHTML = tiles.map((t) => `
      <div class="kpi-tile">
        <div class="label">${escapeHtml(t.label)}</div>
        <div class="value ${t.cls || ""}">${t.value}</div>
        <div class="sub">${escapeHtml(t.sub)}</div>
      </div>
    `).join("");
  }

  // ------------------------------------------------------------------
  // Gráficos por departamento (barra horizontal, uma matiz por depto,
  // fase transmitida por posição no eixo — nunca por 8 cores forçadas)
  // ------------------------------------------------------------------
  function renderChartCardBars(dep, tracks, counts) {
    const max = Math.max(1, ...counts);
    const color = depColorVar(dep);
    return FASES.map((fase, i) => `
      <div class="hbar-row">
        <div class="lbl">${escapeHtml(fase)}</div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${(counts[i] / max) * 100}%; background:${color};"></div></div>
        <div class="count">${counts[i]}</div>
      </div>
    `).join("");
  }

  function renderChartCardPie(dep, tracks, counts) {
    const total = counts.reduce((s, c) => s + c, 0);
    if (!total) {
      return `<div class="kcol-empty">Nenhuma trilha aplicável nesta fase/departamento</div>`;
    }
    let acc = 0;
    const stops = FASES.map((fase, i) => {
      const from = (acc / total) * 100;
      acc += counts[i];
      const to = (acc / total) * 100;
      return `${faseCorPizza(fase)} ${from}% ${to}%`;
    }).join(", ");
    const legend = FASES.map((fase, i) => {
      if (!counts[i]) return "";
      const pct = Math.round((counts[i] / total) * 100);
      return `
        <div class="pie-legend-row">
          <span class="sw" style="background:${faseCorPizza(fase)}"></span>
          <span class="pie-legend-lbl">${escapeHtml(fase)}</span>
          <span class="pie-legend-val">${counts[i]} (${pct}%)</span>
        </div>
      `;
    }).join("");
    return `
      <div class="pie-row">
        <div class="pie-visual" style="background: conic-gradient(${stops});" role="img"
             aria-label="Distribuição de ${escapeHtml(dep)} por fase: ${FASES.map((f, i) => `${f} ${counts[i]}`).join(", ")}"></div>
        <div class="pie-legend">${legend}</div>
      </div>
    `;
  }

  function renderCharts() {
    const grid = $("#chartGrid");
    grid.innerHTML = DEPARTAMENTOS.map((dep) => {
      const tracks = allTracks({ ignoreDeptTab: true }).filter((t) => t.dep === dep);
      const counts = FASES.map((fase) => tracks.filter((t) => t.track.faseAtual === fase).length);
      const color = depColorVar(dep);
      const body = STATE.chartView === "pizza"
        ? renderChartCardPie(dep, tracks, counts)
        : renderChartCardBars(dep, tracks, counts);
      return `
        <div class="chart-card">
          <div class="chart-head">
            <strong style="color:${color}">${escapeHtml(dep)}</strong>
            <span style="color:var(--text-muted); font-size:11px;">${tracks.length} cliente(s)</span>
          </div>
          ${body}
        </div>
      `;
    }).join("");

    $("#meterCol").innerHTML = DEPARTAMENTOS.map((dep) => {
      const tracks = allTracks({ ignoreDeptTab: true }).filter((t) => t.dep === dep && t.track.faseAtual !== FASE_NAO_APLICAVEL);
      const pct = tracks.length ? Math.round(100 * tracks.reduce((s, t) => s + trackProgress01(t.track), 0) / tracks.length) : 0;
      const color = depColorVar(dep);
      return `
        <div class="meter-row">
          <span class="dot" style="background:${color}"></span>
          <span class="name">${escapeHtml(dep)}</span>
          <div class="meter-track"><div class="meter-fill" style="width:${pct}%; background:${color};"></div></div>
          <span class="pct">${pct}%</span>
        </div>
      `;
    }).join("");
  }

  // ------------------------------------------------------------------
  // Kanban
  // ------------------------------------------------------------------
  function renderKanban() {
    const tracks = allTracks();
    const cols = [...FASES, FASE_NAO_APLICAVEL];

    $("#kanban").innerHTML = cols.map((fase) => {
      const inCol = tracks.filter((t) => t.track.faseAtual === fase);
      const cards = inCol.map((t) => {
        const st = trackStatus(t.track);
        const showDep = STATE.filters.dept === "__all__";
        return `
          <button class="card" data-dep="${escapeHtml(t.dep)}" data-cliente="${escapeHtml(t.cliente.id)}" data-dep-key="${escapeHtml(t.dep)}">
            <div class="cname">${escapeHtml(t.cliente.nome)}</div>
            <div class="cmeta">${escapeHtml(t.cliente.cidade)}/${escapeHtml(t.cliente.estado)} · ${escapeHtml(t.track.responsavel || "sem responsável")}</div>
            <div class="cfoot">
              ${showDep ? `<span class="cdep" style="color:${depColorVar(t.dep)}">${escapeHtml(t.dep)}</span>` : "<span></span>"}
              <span class="badge status-${st.cls || st.key}">${escapeHtml(st.label)}</span>
            </div>
          </button>
        `;
      }).join("") || `<div class="kcol-empty">Nenhum cliente nesta fase</div>`;

      return `
        <div class="kcol">
          <div class="kcol-head">
            <span class="t">${escapeHtml(fase)}</span>
            <span class="n">${inCol.length}</span>
          </div>
          <div class="kcol-body">${cards}</div>
        </div>
      `;
    }).join("");

    $$("#kanban .card").forEach((btn) => {
      btn.addEventListener("click", () => openDetailModal(btn.dataset.cliente, btn.dataset.depKey));
    });
  }

  // ------------------------------------------------------------------
  // Tabela completa (twin acessível do Kanban/gráficos)
  // ------------------------------------------------------------------
  const TABLE_COLS = [
    { key: "nome", label: "Cliente" },
    { key: "ni", label: "CPF/CNPJ/CAEPF" },
    { key: "cidade", label: "Cidade/UF" },
    { key: "regime", label: "Regime Tributário" },
    { key: "dep", label: "Departamento" },
    { key: "faseAtual", label: "Fase" },
    { key: "status", label: "Status" },
    { key: "responsavel", label: "Responsável" },
    { key: "prioridade", label: "Prioridade" },
    { key: "dataConclusaoPrevista", label: "Previsão conclusão" },
  ];

  function tableRows() {
    return allTracks().map((t) => {
      const st = trackStatus(t.track);
      return {
        nome: t.cliente.nome,
        ni: t.cliente.ni,
        cidade: `${t.cliente.cidade}/${t.cliente.estado}`,
        regime: t.cliente.regimeTributario || "—",
        dep: t.dep,
        faseAtual: t.track.faseAtual,
        status: st.label,
        statusKey: st.cls || st.key,
        responsavel: t.track.responsavel || "—",
        prioridade: t.track.prioridade || "—",
        dataConclusaoPrevista: t.track.dataConclusaoPrevista,
        _clienteId: t.cliente.id,
        _dep: t.dep,
      };
    });
  }

  function renderTable() {
    let rows = tableRows();
    const { col, dir } = STATE.tableSort;
    rows.sort((a, b) => {
      const av = a[col] ?? "", bv = b[col] ?? "";
      return av > bv ? dir : av < bv ? -dir : 0;
    });

    $("#dataTable thead").innerHTML = `<tr>${TABLE_COLS.map((c) =>
      `<th data-col="${c.key}">${escapeHtml(c.label)}${STATE.tableSort.col === c.key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`
    ).join("")}</tr>`;

    $("#dataTable tbody").innerHTML = rows.map((r) => `
      <tr data-cliente="${escapeHtml(r._clienteId)}" data-dep="${escapeHtml(r._dep)}">
        <td>${escapeHtml(r.nome)}</td>
        <td>${escapeHtml(r.ni)}</td>
        <td>${escapeHtml(r.cidade)}</td>
        <td>${escapeHtml(r.regime)}</td>
        <td style="color:${depColorVar(r.dep)}">${escapeHtml(r.dep)}</td>
        <td>${escapeHtml(r.faseAtual)}</td>
        <td><span class="badge status-${r.statusKey}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(r.responsavel)}</td>
        <td>${escapeHtml(r.prioridade)}</td>
        <td>${fmtDateBR(r.dataConclusaoPrevista)}</td>
      </tr>
    `).join("");

    $$("#dataTable thead th").forEach((th) => th.addEventListener("click", () => {
      const c = th.dataset.col;
      STATE.tableSort.dir = STATE.tableSort.col === c ? -STATE.tableSort.dir : 1;
      STATE.tableSort.col = c;
      renderTable();
    }));
    $$("#dataTable tbody tr").forEach((tr) => tr.addEventListener("click", () => openDetailModal(tr.dataset.cliente, tr.dataset.dep)));
  }

  // ------------------------------------------------------------------
  // Filtros / opções de select dinâmicas
  // ------------------------------------------------------------------
  function populateFilterOptions() {
    const cidades = [...new Set(STATE.clientes.map((c) => c.cidade))].sort();
    $("#fCidade").innerHTML = `<option value="">Todas as cidades</option>` +
      cidades.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

    $("#fPrioridade").innerHTML = `<option value="">Todas as prioridades</option>` +
      PRIORIDADES.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");

    $("#fStatus").innerHTML = `<option value="">Todos os status</option>` + [
      ["good", "No prazo / Concluído"], ["warning", "Atenção"], ["critical", "Atrasado"],
      ["neutral", "Sem data definida"], ["na", "Não aplicável"],
    ].map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("");

    $("#depTabs").innerHTML = ["__all__", ...DEPARTAMENTOS].map((d) => `
      <button class="dep-tab" data-dep="${escapeHtml(d)}" data-active="${STATE.filters.dept === d}">
        ${d === "__all__" ? "Visão Geral" : escapeHtml(d)}
      </button>
    `).join("");
    $$("#depTabs .dep-tab").forEach((b) => b.addEventListener("click", () => {
      STATE.filters.dept = b.dataset.dep;
      renderAll();
    }));

    $("#regimeTabs").innerHTML = ["__all__", ...REGIMES].map((r) => `
      <button class="regime-tab" data-regime="${escapeHtml(r)}" data-active="${STATE.filters.regime === r}">
        ${r === "__all__" ? "Todos os regimes" : escapeHtml(r)}
      </button>
    `).join("");
    $$("#regimeTabs .regime-tab").forEach((b) => b.addEventListener("click", () => {
      STATE.filters.regime = b.dataset.regime;
      renderAll();
    }));
  }

  // ------------------------------------------------------------------
  // Modal de detalhe (somente leitura — editar é sempre na planilha)
  // ------------------------------------------------------------------
  function openDetailModal(clienteId, dep) {
    const cliente = STATE.clientes.find((c) => c.id === clienteId);
    if (!cliente) return;
    const track = cliente.departamentos[dep];
    if (!track) return;

    const st = trackStatus(track);
    const cfg = window.APP_CONFIG || {};
    const sheetUrl = cfg.sheetEditUrl || cfg.sheetCsvUrl || "#";

    $("#modalRoot").innerHTML = `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal">
          <h3>${escapeHtml(cliente.nome)}</h3>
          <div class="modal-sub" style="color:${depColorVar(dep)}">${escapeHtml(dep)} · ${escapeHtml(cliente.ni)} · ${escapeHtml(cliente.cidade)}/${escapeHtml(cliente.estado)}${cliente.regimeTributario ? " · " + escapeHtml(cliente.regimeTributario) : ""}</div>

          <div class="field-row">
            <div class="field"><label>Fase atual</label><div>${escapeHtml(track.faseAtual)}</div></div>
            <div class="field"><label>Status</label><div><span class="badge status-${st.cls || st.key}">${escapeHtml(st.label)}</span></div></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Responsável</label><div>${escapeHtml(track.responsavel || "—")}</div></div>
            <div class="field"><label>Prioridade</label><div>${escapeHtml(track.prioridade || "—")}</div></div>
          </div>
          <div class="field"><label>Conclusão prevista</label><div>${fmtDateBR(track.dataConclusaoPrevista)}</div></div>
          <div class="field"><label>Observações / bloqueios</label><div>${escapeHtml(track.observacoes) || "—"}</div></div>

          <div class="modal-actions">
            <button class="ghost" id="mCancel">Fechar</button>
            <a class="primary" style="text-decoration:none; display:inline-block;" href="${escapeHtml(sheetUrl)}" target="_blank" rel="noopener">Editar na planilha ↗</a>
          </div>
          <div class="modal-sub" style="margin-top:12px;">
            Para mudar a fase, responsável, datas ou observações, edite direto na planilha
            (use Ctrl+F e busque por "${escapeHtml(cliente.nome)}"). O painel atualiza sozinho
            na próxima abertura. Histórico de alterações: menu Arquivo → Histórico de versões, na planilha.
          </div>
        </div>
      </div>
    `;

    $("#mCancel").addEventListener("click", closeModal);
    $("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
  }

  function closeModal() {
    $("#modalRoot").innerHTML = "";
    STATE.detail = null;
  }

  // ------------------------------------------------------------------
  // Exportar cópia local (backup / análise offline)
  // ------------------------------------------------------------------
  function exportJson() {
    const blob = new Blob([JSON.stringify(STATE.clientes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clientes_snapshot.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------------
  // UI utilitária
  // ------------------------------------------------------------------
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._h);
    showToast._h = setTimeout(() => t.classList.remove("show"), 3200);
  }

  function renderAll() {
    populateFilterOptions();
    renderKpis();
    renderCharts();
    if (!STATE.boardCollapsed) {
      if (STATE.view === "kanban") { renderKanban(); }
      else { renderTable(); }
    }
    $("#kanbanWrap").classList.toggle("hidden", STATE.boardCollapsed || STATE.view !== "kanban");
    $("#tableWrap").classList.toggle("hidden", STATE.boardCollapsed || STATE.view !== "tabela");
    $("#btnToggleBoard").textContent = STATE.boardCollapsed ? "▸ Mostrar quadro" : "▾ Minimizar";
    const atualizado = STATE.lastFetch ? fmtDateTimeBR(STATE.lastFetch) : "—";
    $("#headerMeta").textContent = `Fonte: Google Sheets · atualizado em ${atualizado} · ${STATE.clientes.length} clientes`;
  }

  async function refresh({ silent = false } = {}) {
    try {
      await loadData();
      renderAll();
      if (!silent) showToast("Dados atualizados da planilha.");
    } catch (e) {
      showToast("Erro ao atualizar: " + e.message);
    }
  }

  function wireStaticControls() {
    $("#search").addEventListener("input", (e) => { STATE.filters.search = e.target.value; renderAll(); });
    $("#fCidade").addEventListener("change", (e) => { STATE.filters.cidade = e.target.value; renderAll(); });
    $("#fPrioridade").addEventListener("change", (e) => { STATE.filters.prioridade = e.target.value; renderAll(); });
    $("#fStatus").addEventListener("change", (e) => { STATE.filters.status = e.target.value; renderAll(); });

    $("#viewKanban").addEventListener("click", () => { STATE.view = "kanban"; setViewButtons(); renderAll(); });
    $("#viewTabela").addEventListener("click", () => { STATE.view = "tabela"; setViewButtons(); renderAll(); });

    $("#btnToggleBoard").addEventListener("click", () => {
      STATE.boardCollapsed = !STATE.boardCollapsed;
      try { localStorage.setItem("painelBoardCollapsed", STATE.boardCollapsed ? "1" : "0"); } catch (e) {}
      renderAll();
    });

    $("#viewChartBarras").addEventListener("click", () => { STATE.chartView = "barras"; setChartViewButtons(); renderCharts(); });
    $("#viewChartPizza").addEventListener("click", () => { STATE.chartView = "pizza"; setChartViewButtons(); renderCharts(); });

    $("#btnExport").addEventListener("click", exportJson);
    $("#btnRefresh").addEventListener("click", () => refresh());

    $("#themeToggle").addEventListener("click", () => {
      const html = document.documentElement;
      const current = html.dataset.theme === "dark" ? "dark" :
        (html.dataset.theme === "light" ? "light" : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
      html.dataset.theme = current === "dark" ? "light" : "dark";
      $("#themeToggle").textContent = html.dataset.theme === "dark" ? "☀️" : "🌙";
    });
  }

  function setViewButtons() {
    $("#viewKanban").classList.toggle("primary", STATE.view === "kanban");
    $("#viewTabela").classList.toggle("primary", STATE.view === "tabela");
  }

  function setChartViewButtons() {
    $("#viewChartBarras").classList.toggle("primary", STATE.chartView === "barras");
    $("#viewChartPizza").classList.toggle("primary", STATE.chartView === "pizza");
  }

  async function init() {
    try {
      STATE.boardCollapsed = localStorage.getItem("painelBoardCollapsed") === "1";
    } catch (e) { /* localStorage indisponível — mantém expandido por padrão */ }
    try {
      await loadData();
    } catch (e) {
      $("#app").innerHTML = `<div class="wrap"><p style="color:var(--status-critical)">Erro ao carregar dados: ${escapeHtml(e.message)}</p></div>`;
      return;
    }
    wireStaticControls();
    setViewButtons();
    setChartViewButtons();
    renderAll();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
