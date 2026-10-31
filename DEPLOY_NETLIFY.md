# Configuração para publicar no Netlify

## 1. Banco PostgreSQL
Crie um banco PostgreSQL (por exemplo, Neon ou outro provedor compatível). No console SQL do banco, execute todo o arquivo `database/schema.sql`.

## 2. Variáveis no Netlify
Em Site configuration > Environment variables, configure:
- `DATABASE_URL`: string de conexão PostgreSQL com SSL.
- `JWT_SECRET`: segredo aleatório forte, com pelo menos 32 caracteres.
- `SUMUP_API_KEY`: chave de API da sua conta SumUp.
- `SUMUP_MERCHANT_CODE`: código do estabelecimento SumUp.
- `APP_URL`: `https://telepronto.netlify.app`.
- `MCP_ACCESS_TOKEN`: token aleatório forte para proteger o endpoint MCP.

Não coloque valores reais dessas chaves no GitHub ou no navegador.

## 3. SumUp
Ative o acesso à API/checkout online na conta SumUp. Configure primeiro em sandbox, se disponível para sua conta. O checkout hospedado retorna o usuário ao Telepronto; a função webhook consulta o checkout diretamente na SumUp e só credita quando o status for `PAID`.

O código oferece pacotes em BRL e USD, mas a moeda efetivamente aceita depende da habilitação e do país da conta comerciante SumUp. Confirme isso no painel antes de anunciar pagamentos internacionais.

## 4. Deploy
Faça deploy da branch `feature/conta-creditos-sumup-mcp` como Deploy Preview no Netlify, configure as variáveis nesse contexto e valide cadastro, login, checkout sandbox, confirmação, saldo e consumo. Depois de validar, integre a branch à `main` para publicar em produção.

## 5. MCP
Endpoint: `/.netlify/functions/mcp`
Transporte: Streamable HTTP.
Autorização: `Authorization: Bearer <MCP_ACCESS_TOKEN>`.
Ferramentas: `telepronto_status` e `telepronto_credit_packages`.

## Limitação importante da gravação local
Hoje o vídeo é gravado e baixado no próprio navegador, sem envio ao servidor. O sistema valida e debita um crédito pelo endpoint autenticado quando a gravação é finalizada, mas não consegue provar criptograficamente que o navegador realmente gravou o vídeo: código executado pelo próprio cliente pode ser alterado. Para impedir fraude de forma robusta, será necessário enviar o vídeo para armazenamento/backend e só liberar o arquivo após a confirmação do consumo. Isso gera custo de armazenamento e tráfego.

## Observação sobre os textos salvos
A função atual de textos continua usando Netlify Blobs e ainda não vincula os textos a uma conta. A carteira de créditos é individual e fica no PostgreSQL.
