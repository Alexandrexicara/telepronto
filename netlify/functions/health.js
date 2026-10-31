const { db } = require('./lib/db');
const { json } = require('./lib/auth');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
  const configuration = {
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    jwtConfigured: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32),
    sumupConfigured: Boolean(process.env.SUMUP_API_KEY && process.env.SUMUP_MERCHANT_CODE),
    mcpConfigured: Boolean(process.env.MCP_ACCESS_TOKEN && process.env.MCP_ACCESS_TOKEN.length >= 32)
  };
  let databaseConnected = false;
  if (configuration.databaseConfigured) {
    try { await db().query('SELECT 1'); databaseConnected = true; }
    catch (error) { console.error('health database:', error.message); }
  }
  const ready = databaseConnected && configuration.jwtConfigured;
  return json(ready ? 200 : 503, {
    service: 'Telepronto',
    status: ready ? 'ready' : 'configuration_required',
    databaseConnected,
    configuration,
    note: 'Este diagnóstico nunca retorna valores de chaves ou senhas.'
  });
};
