// =============================================================
// Backend principal do SAGA.
// =============================================================

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const { all, get, DB_PATH, inicializarBanco, fecharBanco } = require('./db');

const app = express();
const PORTA = Number(process.env.PORT) || 4000;
const emProducao = process.env.NODE_ENV === 'production';
const segredoSessao = process.env.SESSION_SECRET;

if (!segredoSessao || segredoSessao.length < 32) {
  throw new Error('Defina SESSION_SECRET com pelo menos 32 caracteres no ambiente.');
}

if (!process.env.ADMIN_PASSWORD || !process.env.GUEST_PASSWORD) {
  throw new Error('Defina ADMIN_PASSWORD e GUEST_PASSWORD no ambiente antes de iniciar o SAGA.');
}

if (emProducao && [process.env.ADMIN_PASSWORD, process.env.GUEST_PASSWORD].some((senha) => senha.length < 12)) {
  throw new Error('Em produção, defina senhas com pelo menos 12 caracteres para as duas contas.');
}

if (emProducao) app.set('trust proxy', 1);

// Converte valores monetários brasileiros armazenados como texto no CSV.
function valorCsvSql(coluna) {
  return `CAST(REPLACE(REPLACE(REPLACE(REPLACE(${coluna}, 'R$', ''), '.', ''), ',', '.'), ' ', '') AS REAL)`;
}

// Permite que o Express receba JSON enviado pelo frontend.
app.use(express.json());

// Configura sessão de login.
app.use(session({
  secret: segredoSessao,
  store: new SQLiteStore({
    db: 'saga_sessions.sqlite',
    dir: path.dirname(DB_PATH),
    concurrentDB: true
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: emProducao,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 // 1 hora
  }
}));

// Arquivos públicos
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// -------------------------------------------------------------
// Middleware de proteção.
// Se não existir sessão autenticada, a API retorna erro 401.
// -------------------------------------------------------------
function exigirLogin(req, res, next) {
  if (req.session && req.session.autenticado) {
    return next();
  }
  return res.status(401).json({ erro: 'Acesso não autorizado.' });
}

// -------------------------------------------------------------
// LOGIN
// Contas de demonstração definidas para o protótipo.
// -------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  const contas = {
    [process.env.ADMIN_USERNAME || 'Admin']: process.env.ADMIN_PASSWORD,
    [process.env.GUEST_USERNAME || 'Convidado']: process.env.GUEST_PASSWORD
  };

  if (contas[usuario] && senha === contas[usuario]) {
    req.session.autenticado = true;
    req.session.usuario = usuario;
    return res.json({ sucesso: true });
  }

  return res.status(401).json({
    sucesso: false,
    mensagem: 'Usuário ou senha inválidos.'
  });
});

// Encerra a sessão do usuário.
app.post('/api/logout', exigirLogin, (req, res) => {
  req.session.destroy(() => {
    res.json({ sucesso: true });
  });
});

// Permite ao frontend consultar se ainda existe sessão válida.
app.get('/api/session', (req, res) => {
  res.json({
    autenticado: Boolean(req.session && req.session.autenticado),
    usuario: req.session?.usuario || null
  });
});

// Página principal protegida.
app.get('/dashboard', (req, res) => {
  if (!req.session || !req.session.autenticado) {
    return res.redirect('/');
  }

  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// -------------------------------------------------------------
// API: negócios disponíveis para o seletor do frontend.
// -------------------------------------------------------------
app.get('/api/negocios', exigirLogin, async (req, res) => {
  try {
    const negocios = await all(`
      SELECT DISTINCT NEGOCIO AS codigo,
        CASE NEGOCIO
          WHEN 'Carga aerea' THEN 'Carga aérea'
          WHEN 'Carga rodoviaria' THEN 'Carga rodoviária'
          WHEN 'Exportacao' THEN 'Exportação'
          WHEN 'Importacao' THEN 'Importação'
          ELSE NEGOCIO
        END AS nome
      FROM dados_csv
      WHERE NEGOCIO <> ''
      ORDER BY CASE NEGOCIO
        WHEN 'Carga aerea' THEN 1
        WHEN 'Carga rodoviaria' THEN 2
        WHEN 'Exportacao' THEN 3
        WHEN 'Importacao' THEN 4
        ELSE 5
      END, NEGOCIO
    `);
    res.json(negocios);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// -------------------------------------------------------------
// API: indicadores e distribuição de risco de um negócio.
// -------------------------------------------------------------
app.get('/api/negocios/:negocio/resumo', exigirLogin, async (req, res) => {
  const { negocio } = req.params;

  try {
    const resumo = await get(`
      SELECT
        COUNT(*) AS total_negocios,
        SUM(${valorCsvSql('SALDO_OPERACAO')}) AS saldo_operacao,
        SUM(${valorCsvSql('DESPESA_PCLD_ATUAL')}) AS despesa_pcld_atual,
        SUM(${valorCsvSql('SLD_PCLD_ATUAL')}) AS sld_pcld_atual,
        SUM(${valorCsvSql('SLD_PCLD_PROJETADO')}) AS sld_pcld_projetado
      FROM dados_csv
      WHERE NEGOCIO = ?
    `, [negocio]);

    const categorias = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const riscos = await all(`
      SELECT 'atual' AS serie, RISCO_ATUAL AS risco, COUNT(DISTINCT CCLI) AS quantidade
      FROM dados_csv WHERE NEGOCIO = ? AND RISCO_ATUAL <> '' AND TRIM(CCLI) <> '' GROUP BY RISCO_ATUAL
      UNION ALL
      SELECT 'projetado' AS serie, RISCO_PROJETADO AS risco, COUNT(DISTINCT CCLI) AS quantidade
      FROM dados_csv WHERE NEGOCIO = ? AND RISCO_PROJETADO <> '' AND TRIM(CCLI) <> '' GROUP BY RISCO_PROJETADO
    `, [negocio, negocio]);

    const histograma = categorias.map((risco) => ({
      risco,
      atual: riscos.find((linha) => linha.serie === 'atual' && linha.risco === risco)?.quantidade || 0,
      projetado: riscos.find((linha) => linha.serie === 'projetado' && linha.risco === risco)?.quantidade || 0
    }));
    res.json({ resumo, histograma });
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// -------------------------------------------------------------
// API: soma do saldo por faixa de atraso no negócio selecionado.
// -------------------------------------------------------------
app.get('/api/analise/:codigo', exigirLogin, async (req, res) => {
  const { codigo } = req.params;

  try {
    const faixas = await all(`
      SELECT FAIXA_ATRASO AS faixa, SUM(${valorCsvSql('SALDO')}) AS saldo
      FROM dados_csv
      WHERE NEGOCIO = ?
        AND TRIM(FAIXA_ATRASO) <> ''
        AND UPPER(TRIM(FAIXA_ATRASO)) <> 'LIQUIDADO'
      GROUP BY FAIXA_ATRASO
      ORDER BY CASE FAIXA_ATRASO
        WHEN 'A VENCER' THEN 1 WHEN 'LIQUIDADO' THEN 2 WHEN '01-30 DIAS' THEN 3
        WHEN '31-60 DIAS' THEN 4 WHEN '61-90 DIAS' THEN 5 WHEN '91-180 DIAS' THEN 6
        WHEN '181-360 DIAS' THEN 7 WHEN 'ACIMA DE 360 DIAS' THEN 8 ELSE 9 END, FAIXA_ATRASO
    `, [codigo]);

    res.json(faixas);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// -------------------------------------------------------------
// API: cobrança.
// Lista clientes da carteira, priorizando maior atraso e maior saldo.
// -------------------------------------------------------------
app.get('/api/cobranca/:codigo', exigirLogin, async (req, res) => {
  const { codigo } = req.params;

  try {
    const clientes = await all(`
      SELECT
        CCLI AS ccli,
        SUB_RESULTADO AS sub_resultado,
        FAIXA_ATRASO AS faixa_atraso,
        ${valorCsvSql('SALDO')} AS saldo
      FROM dados_csv
      WHERE NEGOCIO = ?
      ORDER BY CASE FAIXA_ATRASO
        WHEN 'A VENCER' THEN 1 WHEN 'LIQUIDADO' THEN 2 WHEN '01-30 DIAS' THEN 3
        WHEN '31-60 DIAS' THEN 4 WHEN '61-90 DIAS' THEN 5 WHEN '91-180 DIAS' THEN 6
        WHEN '181-360 DIAS' THEN 7 WHEN 'ACIMA DE 360 DIAS' THEN 8 ELSE 9 END DESC
    `, [codigo]);

    res.json(clientes);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// -------------------------------------------------------------
// API: risco.
// Mesmos dados da cobrança, mas ordenados do maior risco para o menor.
// -------------------------------------------------------------
app.get('/api/risco/:codigo', exigirLogin, async (req, res) => {
  const { codigo } = req.params;

  try {
    const clientes = await all(`
      SELECT
        CCLI AS ccli,
        FAIXA_ATRASO AS faixa_atraso,
        ${valorCsvSql('DESPESA_PCLD_ATUAL')} AS despesa_pcld_atual,
        RISCO_ATUAL AS risco_atual
      FROM dados_csv
      WHERE NEGOCIO = ?
      ORDER BY CASE RISCO_ATUAL
        WHEN 'G' THEN 7 WHEN 'F' THEN 6 WHEN 'E' THEN 5 WHEN 'D' THEN 4
        WHEN 'C' THEN 3 WHEN 'B' THEN 2 WHEN 'A' THEN 1 ELSE 0 END DESC,
        CAST(DIAS_VENCIDOS AS INTEGER) DESC
    `, [codigo]);

    res.json(clientes);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// Inicializa o banco antes de disponibilizar o servidor.
let servidor;

async function encerrar(sinal) {
  console.log(`\n${sinal} recebido. Encerrando o SAGA...`);
  if (servidor) {
    await new Promise((resolve) => servidor.close(resolve));
  }
  await fecharBanco();
  console.log('SAGA encerrado.');
  process.exit(0);
}

process.once('SIGINT', () => { void encerrar('SIGINT'); });
process.once('SIGTERM', () => { void encerrar('SIGTERM'); });

inicializarBanco()
  .then(() => {
    servidor = app.listen(PORTA, () => {
      console.log(`SAGA executando na porta ${PORTA}`);
    });
  })
  .catch((erro) => {
    console.error('Falha ao inicializar o banco:', erro);
  });
