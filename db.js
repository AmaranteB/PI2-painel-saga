// =============================================================
// db.js
// =============================================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// DB_PATH pode apontar para um disco persistente no provedor de hospedagem.
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, 'data', 'saga.db'));
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Em hospedagem, inicializa o disco persistente com o banco versionado na primeira execução.
// Depois disso, o banco persistente tem prioridade e não é sobrescrito em novos deploys.
const bancoInicial = path.join(__dirname, 'data', 'saga.db');
if (!fs.existsSync(DB_PATH) && fs.existsSync(bancoInicial)) {
  fs.copyFileSync(bancoInicial, DB_PATH);
  console.log('Banco inicial copiado para:', DB_PATH);
}

// Abre (ou cria) o arquivo SQLite.
const db = new sqlite3.Database(DB_PATH, (erro) => {
  if (erro) {
    console.error('Erro ao abrir o banco:', erro.message);
  } else {
    console.log('Banco SQLite conectado em:', DB_PATH);
  }
});

// Funções auxiliares que transformam as operações do sqlite3 em Promises.
// Isso permite usar async/await no restante do projeto
function run(sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, parametros, function (erro) {
      if (erro) reject(erro);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, parametros, (erro, linha) => {
      if (erro) reject(erro);
      else resolve(linha);
    });
  });
}

function all(sql, parametros = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, parametros, (erro, linhas) => {
      if (erro) reject(erro);
      else resolve(linhas);
    });
  });
}

function fecharBanco() {
  return new Promise((resolve, reject) => {
    db.close((erro) => {
      if (erro) reject(erro);
      else resolve();
    });
  });
}

// Lê registros CSV respeitando campos entre aspas e aspas escapadas.
function lerCsv(texto, delimitador = ';') {
  const linhas = [];
  let linha = [];
  let campo = '';
  let entreAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i];
    if (caractere === '"') {
      if (entreAspas && texto[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else {
        entreAspas = !entreAspas;
      }
    } else if (caractere === delimitador && !entreAspas) {
      linha.push(campo);
      campo = '';
    } else if ((caractere === '\n' || caractere === '\r') && !entreAspas) {
      if (caractere === '\r' && texto[i + 1] === '\n') i += 1;
      linha.push(campo);
      if (linha.some((valor) => valor !== '')) linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += caractere;
    }
  }

  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    if (linha.some((valor) => valor !== '')) linhas.push(linha);
  }
  return linhas;
}

function citarIdentificador(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

async function importarDadosCsv() {
  const caminhoCsv = path.join(__dirname, 'data', 'dados.csv');
  if (!fs.existsSync(caminhoCsv)) {
    console.log('Arquivo data/dados.csv não encontrado; importação ignorada.');
    return;
  }

  const linhas = lerCsv(fs.readFileSync(caminhoCsv, 'utf8').replace(/^\uFEFF/, ''));
  const [colunas, ...registros] = linhas;
  if (!colunas || !colunas.includes('FATURA')) {
    throw new Error('O CSV precisa conter um cabeçalho com a coluna FATURA.');
  }
  const registrosValidos = registros.filter((registro) => registro.length === colunas.length);
  if (registrosValidos.length !== registros.length) {
    throw new Error(`CSV inválido: ${registros.length - registrosValidos.length} linha(s) com quantidade incorreta de colunas.`);
  }

  const colunasSql = colunas.map((coluna) =>
    `${citarIdentificador(coluna)} TEXT${coluna === 'FATURA' ? ' NOT NULL UNIQUE' : ''}`
  );
  await run(`CREATE TABLE IF NOT EXISTS dados_csv (id INTEGER PRIMARY KEY AUTOINCREMENT, ${colunasSql.join(', ')})`);

  const existentes = await get('SELECT COUNT(*) AS total FROM dados_csv');
  if (existentes.total > 0) {
    console.log(`Tabela dados_csv já contém ${existentes.total} registros; importação ignorada.`);
    return;
  }

  const sql = `INSERT INTO dados_csv (${colunas.map(citarIdentificador).join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`;
  await run('BEGIN TRANSACTION');
  try {
    for (const registro of registrosValidos) await run(sql, registro);
    await run('COMMIT');
    console.log(`${registrosValidos.length} registros do CSV importados para dados_csv.`);
  } catch (erro) {
    await run('ROLLBACK');
    throw erro;
  }
}

// Inicializa a tabela de dados importados.
async function inicializarBanco() {
  await importarDadosCsv();
}

module.exports = {
  db,
  DB_PATH,
  run,
  get,
  all,
  fecharBanco,
  inicializarBanco
};
