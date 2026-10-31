# MCP do Telepronto

Endpoint remoto: `https://telepronto.netlify.app/.netlify/functions/mcp`

Transporte: MCP Streamable HTTP (SDK oficial). Requer cabeçalho `Authorization: Bearer <MCP_ACCESS_TOKEN>`.

Ferramentas:
- `telepronto_status`: estado e recursos públicos.
- `telepronto_credit_packages`: pacotes públicos em BRL ou USD.

Defina `MCP_ACCESS_TOKEN` nas variáveis do Netlify. Não publique esse token. O endpoint MCP não expõe dados privados de usuários nem permite alterar saldos.
