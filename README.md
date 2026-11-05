# SAGA

Sistema de acompanhamento, gestão e análise de inadimplência. Projeto de estudo desenvolvido com Node.js, Express, SQLite, HTML, CSS e JavaScript.

## Executar localmente

1. Instale o Node.js 22.9 ou superior.
2. Copie `.env.example` para `.env`. O arquivo contém configurações de demonstração para execução local; personalize as senhas se desejar. Não envie `.env` ao GitHub.
3. Na pasta `SAGA`, execute:

   ```bash
   npm install
   npm start
   ```

4. Abra <http://localhost:4000>.

## Estrutura do projeto

```text
SAGA/
├── data/
│   └── saga.db         # banco SQLite com os dados do projeto
├── public/
│   ├── dashboard.js   # comportamento do painel
│   ├── index.html      # página de login
│   ├── login.js        # autenticação no navegador
│   └── styles.css      # estilos
├── views/
│   └── dashboard.html # página do painel
├── .env.example       # modelo de configuração local
├── .gitignore         # arquivos ignorados pelo Git
├── db.js              # conexão e inicialização do banco
├── package.json       # dependências e comandos
├── package-lock.json  # versões travadas das dependências
├── README.md          # documentação do projeto
└── server.js          # servidor e rotas da aplicação
```

O banco `data/saga.db` é versionado para que o painel já tenha dados ao clonar o projeto. O arquivo local de sessões não é versionado.

