let handlerPromise;
async function getHandler() {
  if (!handlerPromise) handlerPromise = (async () => {
    const { createMcpHandler, McpServer } = await import('@modelcontextprotocol/server');
    const z = await import('zod/v4');
    return createMcpHandler(() => {
      const server = new McpServer({ name:'telepronto', version:'1.0.0' });
      server.registerTool('telepronto_status', {
        description:'Retorna o estado e os recursos públicos do Telepronto.',
        inputSchema:z.z.object({})
      }, async () => ({content:[{type:'text',text:JSON.stringify({service:'Telepronto',status:'online',features:['teleprompter','camera-recording','account-wallet','SumUp-checkout'],pricePerVideo:0.10,currencyOptions:['BRL','USD']})}]}));
      server.registerTool('telepronto_credit_packages', {
        description:'Lista os pacotes públicos de créditos de gravação do Telepronto.',
        inputSchema:z.z.object({currency:z.z.enum(['BRL','USD']).default('BRL')})
      }, async ({currency}) => {
        const factor = currency === 'USD' ? '$' : 'R$';
        const packages = [{videos:10,amount:1},{videos:20,amount:2},{videos:100,amount:10},{videos:500,amount:50}].map(p=>({...p,price:factor+p.amount.toFixed(2)}));
        return {content:[{type:'text',text:JSON.stringify({currency,pricePerVideo:0.10,packages})}]};
      });
      return server;
    });
  })();
  return handlerPromise;
}
exports.handler = async event => {
  const expected = process.env.MCP_ACCESS_TOKEN;
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (!expected || auth !== 'Bearer '+expected) return {statusCode:401,body:'Unauthorized'};
  try {
    const handler = await getHandler();
    const url = 'https://telepronto.netlify.app/.netlify/functions/mcp';
    const headers = new Headers(event.headers || {});
    const method = event.httpMethod || 'POST';
    const body = ['GET','HEAD'].includes(method) ? undefined : (event.isBase64Encoded ? Buffer.from(event.body||'','base64').toString('utf8') : (event.body||''));
    const request = new Request(url,{method,headers,body});
    const response = await handler.fetch(request);
    return {statusCode:response.status,headers:Object.fromEntries(response.headers.entries()),body:await response.text()};
  } catch(e) { console.error('mcp:',e.message); return {statusCode:500,body:'MCP indisponível'}; }
};
