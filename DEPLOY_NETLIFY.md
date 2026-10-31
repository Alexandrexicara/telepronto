# Preparar e publicar o Telepronto

O projeto já contém a estrutura de conta, carteira de créditos, integração SumUp, PostgreSQL e MCP. As credenciais reais são adicionadas somente no painel do Netlify.

## 1. Criar o banco PostgreSQL (Neon)

1. Crie um projeto PostgreSQL no Neon: https://neon.tech/
2. Copie a connection string do projeto usando a conexão pooled quando disponível.
3. No SQL Editor do Neon, execute o arquivo completo `database/schema.sql` deste repositório.
4. No Netlify, cadastre a variável `DATABASE_URL` com a connection string. Não publique essa URL no GitHub nem envie em mensagens.

O banco guarda contas, hashes de senha, carteiras, pagamentos e histórico de créditos. Não é necessário instalar PostgreSQL no computador.

## 2. Variáveis de ambiente do Netlify

Em **Site configuration > Environment variables**, configure:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | Conexão do Neon PostgreSQL |
| `JWT_SECRET` | Segredo aleatório forte, com no mínimo 32 caracteres |
| `SUMUP_API_KEY` | Chave de API da SumUp |
| `SUMUP_MERCHANT_CODE` | Código do estabelecimento SumUp |
| `APP_URL` | URL pública, por exemplo `https://telepronto.netlify.app` |
| `MCP_ACCESS_TOKEN` | Token privado forte para proteger o MCP |

Use geradores seguros para criar `JWT_SECRET` e `MCP_ACCESS_TOKEN). Nunca reutilize a chave da SumUp como segredo JWT. Configure as variáveis nos contextos de Deploy Preview e Production conforme for testar/publicar.

O arquivo `.env.example` lista os nomes das variáveis sem conter credenciais reais.

## 3. SumUp

A integração cria checkouts hospedados em `POST /v0.1/checkouts`. O campo `return_url` aponta para `/.netlify/functions/webhook`; a SumUp envia o ID do checkout por POST. O backend consulta o checkout na API SumUp e só credita após confirmar status `PAID`, valor, moeda e referência.

Configure primeiro as credenciais de teste/sandbox, se sua conta SumUp oferecer esse ambiente. Depois valide pagamento real de baixo valor antes de liberar a venda. A disponibilidade de moedas depende da conta comerciante.

## 4. Verificar a configuração

Depois do deploy, abra:

`https://telepronto.netlify.app/.netlify/functions/health`

O diagnóstico informa se o banco conectou e se cada grupo de credenciais está configurado. Ele nunca exibe os valores dos segredos.

Endpoints principais:
- Cadastro/login: `/.netlify/functions/auth`
- Carteira e checkout: `/.netlify/functions/billing`
- Retorno de status SumUp: `/.netlify/functions/webhook`
- MCP: `/.netlify/functions/mcp`

## 5. MCP

Endpoint remoto: `https://telepronto.netlify.app/.netlify/functions/mcp`

Transporte: Streamable HTTP. Autorização: `Authorization: Bearer <MCP_ACCESS_TOKEN>`.

Ferramentas iniciais: `telepronto_status` e `telepronto_credit_packages`. O endpoint exige token e não deve ser compartilhado publicamente.

## 6. Publicação segura

1. Configure Neon e execute o schema.
2. Configure as variáveis no Netlify para um Deploy Preview.
3. Confirme no GitHub Actions que a validação passou.
4. Teste cadastro, login, saldo, compra sandbox, webhook, crédito e consumo.
5. Só depois integre a branch na `main` para produção.

## Limitações atuais que devem ser consideradas

- Os vídeos continuam sendo gravados e baixados no navegador. O backend registra o consumo de crédito, mas não consegue impedir que alguém altere o JavaScript do próprio navegador. Para controle antifraude real, será necessário enviar o vídeo ao backend/armazenamento.
- A biblioteca de textos existente continua usando Netlify Blobs e ainda não está vinculada à conta do usuário.
- Cadastro por e-mail/senha está implementado, mas verificação de e-mail e recuperação de senha ainda precisam ser adicionadas antes de tratar o sistema como serviço de produção completo.
