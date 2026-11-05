// =============================================================
// login.js
// Controla o formulário de login no navegador.
// =============================================================

const loginForm = document.getElementById('loginForm');
const loginMessage = document.getElementById('loginMessage');
const senhaInput = document.getElementById('senha');
const togglePassword = document.getElementById('togglePassword');

togglePassword.addEventListener('click', () => {
  const mostrarSenha = senhaInput.type === 'password';
  senhaInput.type = mostrarSenha ? 'text' : 'password';
  togglePassword.dataset.visible = String(mostrarSenha);
  togglePassword.setAttribute('aria-pressed', String(mostrarSenha));
  togglePassword.setAttribute('aria-label', mostrarSenha ? 'Ocultar senha' : 'Mostrar senha');
  togglePassword.title = mostrarSenha ? 'Ocultar senha' : 'Mostrar senha';
});

// Escuta o envio do formulário.
loginForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const usuario = document.getElementById('usuario').value.trim();
  const senha = senhaInput.value;

  loginMessage.textContent = 'Validando acesso...';

  try {
    // Envia usuário e senha para o backend.
    const resposta = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ usuario, senha })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      loginMessage.textContent = dados.mensagem || 'Não foi possível entrar.';
      return;
    }

    // Login correto: redireciona para a área protegida.
    window.location.href = '/dashboard';
  } catch (erro) {
    loginMessage.textContent = 'Erro de comunicação com o servidor.';
    console.error(erro);
  }
});
