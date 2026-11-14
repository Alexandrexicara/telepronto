# MCP do Telepronto

Endpoint remoto: `https://telepronto.netlify.app/.netlify/functions/mcp`

Transporte: MCP Streamable HTTP (SDK oficial). O catálogo MCP é público e não exige token; expõe somente informações, ferramentas e preços públicos.

Ferramentas:
- `telepronto_status`: estado e recursos públicos.
- `telepronto_credit_packages`: pacotes públicos em BRL ou USD.

O endpoint MCP não exige token. Ele não expõe dados privados de usuários nem permite alterar saldos.

Ferramentas: `telepronto_status`, `telepronto_credit_packages` e `telepronto_search_catalog`.

Compatibilidade: endpoint configurado para MCP moderno (revisão 2026-07-28) com respostas JSON sem sessão persistente, adequado ao ciclo de vida das Netlify Functions. Clientes antigos que só falam o protocolo 2025 precisam ser atualizados.
