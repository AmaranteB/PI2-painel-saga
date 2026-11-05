// =============================================================
// dashboard.js
// Controla a interatividade do painel do SAGA.
// =============================================================

const sidebar = document.getElementById('sidebar');
const toggleSidebar = document.getElementById('toggleSidebar');
const contentArea = document.getElementById('contentArea');
const pageTitle = document.getElementById('pageTitle');
const negocioSelect = document.getElementById('negocioSelect');
const logoutButton = document.getElementById('logoutButton');
const userChip = document.getElementById('userChip');
const navItems = document.querySelectorAll('.nav-item[data-view]');

// Guarda qual tela está ativa.
let viewAtual = 'negocio';

// -------------------------------------------------------------
// Funções utilitárias.
// -------------------------------------------------------------
function moeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(valor || 0));
}

function numero(valor) {
  return new Intl.NumberFormat('pt-BR').format(Number(valor || 0));
}

function subresultadoExibicao(valor) {
  const texto = String(valor ?? '');
  const correcoes = {
    'BAIXA AUTOM\uFFFDTICA': 'BAIXA AUTOMÁTICA',
    'CONTATO TELEF\uFFFDNICO': 'CONTATO TELEFÔNICO',
    'LIQUIDA\uFFFD\uFFFDO INTEGRAL': 'LIQUIDAÇÃO INTEGRAL',
    'NEGOCIA\uFFFD\uFFFDO': 'NEGOCIAÇÃO'
  };
  return correcoes[texto] || texto;
}

function riscoClasse(nivel) {
  const mapa = {
    A: 'risk-low',
    B: 'risk-low',
    C: 'risk-medium',
    D: 'risk-medium',
    E: 'risk-high',
    F: 'risk-critical',
    G: 'risk-critical',
    Baixo: 'risk-low',
    Médio: 'risk-medium',
    Alto: 'risk-high',
    Crítico: 'risk-critical'
  };
  return mapa[nivel] || '';
}

// Faz requisições para o backend e trata sessão expirada.
async function api(url, opcoes = {}) {
  const resposta = await fetch(url, opcoes);

  if (resposta.status === 401) {
    window.location.href = '/';
    return null;
  }

  if (!resposta.ok) {
    throw new Error('Falha ao consultar o servidor.');
  }

  return resposta.json();
}

// -------------------------------------------------------------
// Menu lateral retrátil.
// -------------------------------------------------------------
toggleSidebar.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const recolhida = sidebar.classList.contains('collapsed');
  toggleSidebar.textContent = recolhida ? '›' : '☰';
  toggleSidebar.title = recolhida ? 'Expandir menu' : 'Recolher menu';
  toggleSidebar.setAttribute('aria-label', toggleSidebar.title);
  toggleSidebar.setAttribute('aria-expanded', String(!recolhida));
});

// -------------------------------------------------------------
// Carrega as carteiras do banco no seletor.
// -------------------------------------------------------------
async function carregarNegocios() {
  const negocios = await api('/api/negocios');
  if (!negocios) return;

  negocioSelect.innerHTML = negocios
    .map(c => `<option value="${c.codigo}">${c.nome}</option>`)
    .join('');
  negocioSelect.value = negocios[0]?.codigo || '';
}

async function carregarUsuarioAtual() {
  const sessao = await api('/api/session');
  if (sessao?.autenticado && sessao.usuario) userChip.textContent = sessao.usuario;
}

// -------------------------------------------------------------
// Troca de tópicos do menu.
// -------------------------------------------------------------
navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(botao => botao.classList.remove('active'));
    item.classList.add('active');
    viewAtual = item.dataset.view;
    renderizarView();
  });
});

// Ao trocar de carteira, atualiza a tela atual.
negocioSelect.addEventListener('change', renderizarView);

// -------------------------------------------------------------
// Renderiza a tela correta de acordo com o menu selecionado.
// -------------------------------------------------------------
async function renderizarView() {
  const negocio = negocioSelect.value;
  const nomeNegocio = negocioSelect.selectedOptions[0]?.textContent || negocio;
  contentArea.innerHTML = '<div class="loading">Carregando dados...</div>';

  try {
    if (viewAtual === 'negocio') {
      pageTitle.textContent = `Visão do Negócio: ${nomeNegocio}`;
      await renderizarNegocio(negocio);
    }

    if (viewAtual === 'analise') {
      pageTitle.textContent = `Análise de Atraso - ${nomeNegocio}`;
      await renderizarAnalise(negocio, nomeNegocio);
    }

    if (viewAtual === 'cobranca') {
      pageTitle.textContent = `Cobrança - ${nomeNegocio}`;
      await renderizarTabelaClientes(negocio, 'cobranca');
    }

    if (viewAtual === 'risco') {
      pageTitle.textContent = `Risco - ${nomeNegocio}`;
      await renderizarTabelaClientes(negocio, 'risco');
    }
  } catch (erro) {
    contentArea.innerHTML = `
      <div class="error-box">
        Não foi possível carregar os dados. ${erro.message}
      </div>
    `;
  }
}

// -------------------------------------------------------------
// TELA CARTEIRA
// Cria os quatro cards e o gráfico de linha.
// -------------------------------------------------------------
async function renderizarNegocio(negocio) {
  const dados = await api(`/api/negocios/${encodeURIComponent(negocio)}/resumo`);
  if (!dados) return;

  const { resumo, histograma } = dados;

  contentArea.innerHTML = `
    <div class="kpi-grid">
      ${cardKpi('Total de negócios', numero(resumo.total_negocios), 'Registros neste negócio')}
      ${cardKpi('Saldo da operação', moeda(resumo.saldo_operacao), 'Soma do saldo da operação')}
      ${cardKpi('Despesa PCLD atual', moeda(resumo.despesa_pcld_atual), 'Despesa PCLD atual')}
      ${cardKpi('PCLD atual', moeda(resumo.sld_pcld_atual), 'Saldo PCLD atual')}
      ${cardKpi('PCLD projetado', moeda(resumo.sld_pcld_projetado), 'Saldo PCLD projetado')}
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Histograma do risco</h2>
          <p>Comparação entre risco atual e projetado.</p>
        </div>
      </div>
      <canvas id="riskChart" class="chart-canvas" width="900" height="360"></canvas>
    </section>
  `;

  desenharGraficoRisco(document.getElementById('riskChart'), histograma);
}

function cardKpi(titulo, valor, legenda) {
  return `
    <article class="kpi-card">
      <span class="kpi-label">${titulo}</span>
      <strong>${valor}</strong>
      <small>${legenda}</small>
    </article>
  `;
}

// -------------------------------------------------------------
// TELA ANÁLISE
// Desenha o gráfico de barras usando Canvas nativo.
// -------------------------------------------------------------
async function renderizarAnalise(negocio, nomeNegocio) {
  const faixas = await api(`/api/analise/${encodeURIComponent(negocio)}`);
  if (!faixas) return;

  const total = faixas.reduce((soma, item) => soma + Number(item.saldo), 0);

  contentArea.innerHTML = `
    <div class="analysis-summary">
      <div>
        <span class="kpi-label">Saldo total em atraso</span>
        <strong>${moeda(total)}</strong>
      </div>
      <p>Soma do saldo por faixa de atraso para ${nomeNegocio}.</p>
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Saldo por faixa de atraso</h2>
          <p>Soma da coluna Saldo agrupada pelas faixas do CSV.</p>
        </div>
      </div>
      <canvas id="barChart" class="chart-canvas" width="900" height="380"></canvas>
    </section>
  `;

  desenharGraficoBarras(document.getElementById('barChart'), faixas);
}

// -------------------------------------------------------------
// TELAS COBRANÇA E RISCO
// As duas usam a mesma tabela, mas o backend muda a ordenação.
// -------------------------------------------------------------
async function renderizarTabelaClientes(negocio, tipo) {
  const clientes = await api(`/api/${tipo}/${encodeURIComponent(negocio)}`);
  if (!clientes) return;

  const colunas = tipo === 'risco'
    ? [
        ['ccli', 'CCLI'],
        ['faixa_atraso', 'Faixa de atraso'],
        ['despesa_pcld_atual', 'Despesa PCLD atual', moeda],
        ['risco_atual', 'Risco atual', (valor) => `<span class="risk-badge ${riscoClasse(valor)}">${valor || '—'}</span>`]
      ]
    : [
        ['ccli', 'CCLI'],
        ['sub_resultado', 'Subresultado', subresultadoExibicao],
        ['faixa_atraso', 'Faixa de atraso'],
        ['saldo', 'Saldo', moeda]
      ];
  const descricao = tipo === 'risco'
    ? 'Despesa PCLD e risco atual por cliente.'
    : 'Resultado da cobrança, faixa de atraso e saldo por cliente.';

  contentArea.innerHTML = `
    <section class="panel table-panel">
      <div class="panel-header">
        <div>
          <h2>${tipo === 'risco' ? 'Risco por cliente' : 'Cobrança por cliente'}</h2>
          <p>${descricao}</p>
        </div>
      </div>

      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              ${colunas.map(([, titulo]) => `<th>${titulo}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${clientes.map(cliente => `
              <tr>${colunas.map(([chave, , formatar]) => {
                const valor = cliente[chave] ?? '—';
                return `<td>${formatar ? formatar(valor) : valor}</td>`;
              }).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// -------------------------------------------------------------
// GRÁFICO DE LINHA EM CANVAS.
// Foi feito sem biblioteca externa para deixar a lógica visível.
// -------------------------------------------------------------
function desenharGraficoRisco(canvas, dados) {
  const ctx = canvas.getContext('2d');
  const largura = canvas.width;
  const altura = canvas.height;
  const margem = { topo: 48, direita: 32, baixo: 48, esquerda: 62 };

  const valores = dados.flatMap(item => [Number(item.atual), Number(item.projetado)]);
  const maximo = Math.max(...valores, 1);
  const teto = Math.ceil(maximo / 4) * 4 || 4;

  ctx.clearRect(0, 0, largura, altura);
  ctx.font = '14px Arial';
  ctx.lineWidth = 1;

  // Grade e valores do eixo Y.
  for (let i = 0; i <= 4; i++) {
    const y = margem.topo + ((altura - margem.topo - margem.baixo) / 4) * i;
    const valor = teto - (teto / 4) * i;

    ctx.strokeStyle = i === 4 ? '#aab7c8' : '#e8edf4';
    ctx.beginPath();
    ctx.moveTo(margem.esquerda, y);
    ctx.lineTo(largura - margem.direita, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.fillText(numero(Math.round(valor)), margem.esquerda - 12, y + 5);
  }

  const larguraUtil = largura - margem.esquerda - margem.direita;
  const alturaUtil = altura - margem.topo - margem.baixo;
  const espaco = larguraUtil / dados.length;
  const larguraBarra = Math.min(40, espaco * 0.34);
  const cores = { atual: '#315fbd', projetado: '#18a999' };
  dados.forEach((item, indice) => {
    const centro = margem.esquerda + espaco * (indice + 0.5);
    [['atual', item.atual], ['projetado', item.projetado]].forEach(([serie, quantidade], posicao) => {
      const alturaBarra = (Number(quantidade) / teto) * alturaUtil;
      const x = centro + (posicao === 0 ? -larguraBarra : 0);
      const y = margem.topo + alturaUtil - alturaBarra;
      ctx.fillStyle = cores[serie];
      const barra = larguraBarra - 5;
      const raio = Math.min(7, barra / 2, alturaBarra / 2);
      if (alturaBarra > 0) {
        ctx.beginPath();
        ctx.roundRect(x, y, barra, alturaBarra, [raio, raio, 0, 0]);
        ctx.fill();
      }
      ctx.fillStyle = '#334155';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(numero(quantidade), x + barra / 2, Math.max(y - 8, margem.topo + 13));
    });
    ctx.fillStyle = '#334155';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(item.risco, centro, altura - 28);
  });
  ctx.fillStyle = cores.atual;
  ctx.beginPath();
  ctx.roundRect(largura - 230, 12, 12, 12, 4);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.fillText('Risco atual', largura - 210, 22);
  ctx.fillStyle = cores.projetado;
  ctx.beginPath();
  ctx.roundRect(largura - 112, 12, 12, 12, 4);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.fillText('Projetado', largura - 92, 22);
}

// -------------------------------------------------------------
// GRÁFICO DE BARRAS EM CANVAS.
// -------------------------------------------------------------
function desenharGraficoBarras(canvas, dados) {
  const ctx = canvas.getContext('2d');
  const largura = canvas.width;
  const altura = canvas.height;
  const margem = { topo: 35, direita: 25, baixo: 75, esquerda: 85 };

  const valores = dados.map(item => Number(item.saldo));
  const maximo = Math.max(...valores, 1000);
  const teto = Math.ceil(maximo / 10000) * 10000 || 10000;

  ctx.clearRect(0, 0, largura, altura);
  ctx.font = '13px Arial';

  // Eixo Y e linhas de grade.
  for (let i = 0; i <= 5; i++) {
    const y = margem.topo + ((altura - margem.topo - margem.baixo) / 5) * i;
    const valor = teto - (teto / 5) * i;

    ctx.strokeStyle = '#dbe3ec';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margem.esquerda, y);
    ctx.lineTo(largura - margem.direita, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(moeda(valor).replace(',00', ''), margem.esquerda - 10, y + 5);
  }

  const larguraUtil = largura - margem.esquerda - margem.direita;
  const alturaUtil = altura - margem.topo - margem.baixo;
  const espaco = larguraUtil / dados.length;
  const larguraBarra = espaco * 0.58;

  dados.forEach((item, indice) => {
    const valor = Number(item.saldo);
    const alturaBarra = (valor / teto) * alturaUtil;
    const x = margem.esquerda + espaco * indice + (espaco - larguraBarra) / 2;
    const y = margem.topo + alturaUtil - alturaBarra;

    ctx.fillStyle = '#315fbd';
    const raio = Math.min(8, larguraBarra / 2, alturaBarra / 2);
    if (alturaBarra > 0) {
      ctx.beginPath();
      ctx.roundRect(x, y, larguraBarra, alturaBarra, [raio, raio, 0, 0]);
      ctx.fill();
    }

    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    const rotulos = {
      'A VENCER': 'A vencer',
      '01-30 DIAS': '01–30 dias',
      '31-60 DIAS': '31–60 dias',
      '61-90 DIAS': '61–90 dias',
      '91-180 DIAS': '91–180 dias',
      '181-360 DIAS': '181–360 dias',
      'ACIMA DE 360 DIAS': '> 360 dias'
    };
    ctx.fillText(rotulos[item.faixa] || item.faixa, x + larguraBarra / 2, altura - 30);

    if (valor > 0) {
      ctx.font = '12px Arial';
      ctx.fillText(moeda(valor).replace(',00', ''), x + larguraBarra / 2, y - 10);
      ctx.font = '13px Arial';
    }
  });

  ctx.textAlign = 'left';
}

// -------------------------------------------------------------
// Logout.
// -------------------------------------------------------------
logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// -------------------------------------------------------------
// Inicialização da tela.
// -------------------------------------------------------------
(async function iniciar() {
  await carregarUsuarioAtual();
  await carregarNegocios();
  await renderizarView();
})();
