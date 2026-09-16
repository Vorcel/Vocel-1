# Configurar o Google Drive no Vorcel

Passo a passo para ligar a integração de propostas (Google Drive + Google Docs).
Faz-se **uma vez**, por quem administra o sistema. Depois, cada usuário conecta a
própria conta Google sozinho, em *Configurações › Integrações*.

**Tempo estimado:** 15 minutos.

URLs reais deste projeto (confirmadas no código, não invente outras):

| O que | Endereço |
|---|---|
| Backend (Render) | `https://vocel-backend.onrender.com` |
| Redirect URI de produção | `https://vocel-backend.onrender.com/api/integrations/google/callback` |
| Redirect URI de teste local | `http://localhost:8000/api/integrations/google/callback` |
| Frontend de produção | *o seu domínio na Vercel* — anote, será usado no passo 9 |
| Frontend local | `http://localhost:3000` |

---

## 1. Criar ou escolher o projeto no Google Cloud

1. Acesse <https://console.cloud.google.com/>.
2. No seletor de projetos (barra do topo), clique em **Novo projeto**.
3. Nome: `Vorcel`. Clique em **Criar** e aguarde.
4. Confirme que o seletor do topo está mostrando **Vorcel** antes de continuar.

## 2. Ativar a Google Drive API

1. Menu (☰) › **APIs e serviços** › **Biblioteca**.
2. Busque por **Google Drive API**.
3. Clique nela e depois em **Ativar**.

> A Google Docs API **não** é necessária. Toda a conversão, exportação e edição
> acontece via Drive API — é ela que converte o `.docx` em Google Docs e exporta
> de volta em DOCX/PDF.

## 3. Google Picker — não precisa

Você escolheu a opção "criar pasta padrão", então **não** usamos o Google Picker.
Nada a ativar aqui, e **nenhuma variável no Vercel**.

## 4. Tela de consentimento (OAuth Consent Screen)

1. **APIs e serviços** › **Tela de permissão OAuth**.
2. Tipo de usuário: **Externo** › **Criar**.
3. Preencha:
   - Nome do app: `Vorcel`
   - E-mail de suporte: o seu
   - E-mail do desenvolvedor: o seu
4. **Salvar e continuar**.
5. Em **Escopos**, clique em **Adicionar ou remover escopos** e marque:
   - `.../auth/drive.file` — *See, edit, create, and delete only the specific Google Drive files you use with this app*
   - `.../auth/userinfo.email`
6. **Salvar e continuar** até o fim.

> **Por que só `drive.file`:** é o menor escopo possível. O Vorcel enxerga
> **apenas** a pasta e os documentos que ele mesmo criou no seu Drive — nunca o
> resto dos seus arquivos. Isso também evita a verificação pesada do Google.

## 5. Criar o OAuth Client ID

1. **APIs e serviços** › **Credenciais** › **Criar credenciais** › **ID do cliente OAuth**.
2. Tipo de aplicativo: **Aplicativo da Web**.
3. Nome: `Vorcel Web`.
4. Preencha os dois blocos abaixo (passos 6 e 7) e clique em **Criar**.
5. Guarde o **Client ID** e o **Client Secret** que aparecem. O *secret* é senha:
   não cole em e-mail, chat, código ou GitHub.

## 6. Authorized JavaScript Origins

Como o OAuth roda **inteiramente no backend**, este campo não é usado pelo fluxo.
Pode deixar vazio. Se o Google exigir algo, informe o endereço do frontend
(produção e, se for testar local, `http://localhost:3000`).

## 7. Authorized redirect URIs

Estes são **obrigatórios** e precisam ser idênticos, caractere por caractere:

```
https://vocel-backend.onrender.com/api/integrations/google/callback
http://localhost:8000/api/integrations/google/callback
```

A segunda linha só é necessária se você quiser testar na sua máquina. Sem ela, o
teste local falha com `redirect_uri_mismatch`.

## 8. Usuários de teste

Enquanto o app estiver em **Testing**:

1. Tela de permissão OAuth › **Usuários de teste** › **Adicionar usuários**.
2. Inclua todos os e-mails Google que vão conectar (o seu e os da equipe).

> ⚠️ **Importante:** em modo *Testing* o Google **expira o refresh token em 7
> dias** — você teria que reconectar toda semana. Para valer de verdade, vá em
> **Tela de permissão OAuth** › **Publicar app** › **Confirmar**. Como usamos só
> `drive.file` + `userinfo.email` (escopos não restritos), a publicação **não**
> exige auditoria de segurança nem vídeo de demonstração.

## 9. Variáveis no Render (backend)

No painel do Render, serviço do backend › **Environment** › **Add Environment Variable**:

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | o Client ID do passo 5 |
| `GOOGLE_CLIENT_SECRET` | o Client Secret do passo 5 |
| `GOOGLE_REDIRECT_URI` | `https://vocel-backend.onrender.com/api/integrations/google/callback` |
| `FRONTEND_URL` | o endereço do seu frontend, **sem barra no final** |
| `TOKEN_ENCRYPTION_KEY` | *(opcional)* — ver abaixo |

`FRONTEND_URL` é para onde o usuário volta depois de autorizar. Se estiver errado,
a conexão funciona mas a pessoa cai numa página em branco.

**`TOKEN_ENCRYPTION_KEY` (opcional):** se você não definir, a chave de criptografia
dos refresh tokens é derivada do `JWT_SECRET` que já existe — funciona sem fazer
nada. Se quiser uma chave separada (recomendado a longo prazo), gere assim e cole
o resultado:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> Se um dia você **trocar** essa chave (ou o `JWT_SECRET`, caso esteja usando o
> padrão), as conexões existentes param de funcionar e cada usuário precisa clicar
> em **Reconectar**. Nada é perdido — nem propostas, nem arquivos.

## 10. Vercel (frontend)

**Nenhuma variável nova.** Nenhum segredo do Google chega ao navegador — é essa a
ideia. O frontend só conversa com o backend do Vorcel.

---

## 11. Primeiro login e conexão

1. Abra o Vorcel e entre com a sua conta.
2. **Configurações › Integrações**. O card Google Drive deve sair de
   *"Não configurado"* para **"Não conectado"** com o botão disponível.
3. Clique em **Conectar com Google**.
4. Escolha a conta, revise as permissões e autorize.
5. Você volta ao Vorcel com o aviso *"Google Drive conectado"* e o selo **verde**.

> Se aparecer "O app não foi verificado pelo Google": clique em **Avançado** ›
> **Acessar Vorcel (não seguro)**. É normal enquanto o app não estiver publicado,
> e só acontece com quem está na lista de usuários de teste.

## 12. Criar a pasta padrão

1. Ainda em Integrações, clique em **Criar pasta padrão**.
2. Deixe o nome `Propostas` (ou escolha outro) e confirme.
3. O card passa a mostrar `Vorcel / Propostas`.
4. Clique em **Abrir pasta** — deve abrir a pasta vazia no seu Google Drive.

A partir daqui, **toda** proposta enviada vai automaticamente para lá. Você não
escolhe pasta a cada upload.

## 13. Testar o upload

1. Vá em **Licitações**.
2. Clique no **P desbotado** de qualquer licitação.
3. Selecione um `.docx` e clique em **Salvar proposta**.
4. O P fica **azul vivo** na hora e o visualizador abre mostrando o documento.

## 14. Testar o Google Docs

1. Confira que o documento apareceu em `Vorcel / Propostas` no seu Drive — e que
   o ícone é o do **Google Docs**, não o do Word (prova de que converteu).
2. No visualizador do Vorcel, clique em **Editar**: abre o Google Docs em outra aba.
3. Mude alguma coisa no texto e aguarde o Docs salvar sozinho.
4. Volte ao Vorcel, feche e reabra o visualizador: a alteração tem que aparecer.
5. Clique em **PDF** e em **DOCX**: os dois arquivos precisam conter a alteração.

> Vale conferir com uma proposta **de verdade** logo no primeiro teste: a conversão
> do Word para Google Docs pode mexer em tabelas complexas, cabeçalho/rodapé e
> fontes. O original nunca é alterado — ele fica guardado intacto no Vorcel.

## 15. Confirmar que o refresh token funciona

O teste de verdade é **tempo**: feche tudo, e no dia seguinte (ou depois de
algumas horas) abra o Vorcel e clique num P azul. Se o documento abrir sem pedir
login do Google, a renovação automática está funcionando.

Se algum dia aparecer *"Conexão com Google Drive expirada"*, basta clicar em
**Reconectar** — as propostas continuam intactas.

Checagem rápida no Render (aba **Logs**), logo depois de conectar:

- **Sem erro** = tudo certo.
- `Google token endpoint respondeu 400` = o refresh token foi revogado. Reconecte.
- Se voltar a expirar toda semana, o app ainda está em **Testing** (volte ao passo 8).

---

## Se der errado

| Mensagem | O que fazer |
|---|---|
| `redirect_uri_mismatch` | A URI do passo 7 está diferente da variável `GOOGLE_REDIRECT_URI`. Precisa ser idêntica, incluindo `https` e sem barra no final. |
| Card preso em "Não configurado" | Faltou alguma das três variáveis do passo 9 no Render, ou o serviço não reiniciou depois de salvá-las. |
| Volta para uma página em branco | `FRONTEND_URL` errado ou com barra no final. |
| "Você cancelou a autorização" | Alguma permissão foi desmarcada na tela de consentimento. Tente de novo aceitando todas. |
| "Não foi possível sincronizar" | A proposta **está salva** no Vorcel. Clique em **Tentar sincronizar novamente** no visualizador. |
| "Documento não encontrado no Google Drive" | Alguém apagou o Google Docs. Clique em **Recriar no Google Drive** — o Vorcel reenvia a partir do original. |

**Nada disso apaga nada.** O arquivo original de toda proposta fica guardado no
armazenamento do próprio Vorcel, independente do Google.
