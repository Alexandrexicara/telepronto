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
  let schemaReady = false;
  let missingTables = [];
  let databaseError = null;

  if (configuration.databaseConfigured) {
    try {
      const result = await db().query(`
        SELECT
          to_regclass('public.users') IS NOT NULL AS users,
          to_regclass('public.wallets') IS NOT NULL AS wallets,
          to_regclass('public.payments') IS NOT NULL AS payments,
          to_regclass('public.credit_ledger') IS NOT NULL AS credit_ledger
      `);
      databaseConnected = true;
      const tables = result.rows[0] || {};
      missingTables = Object.entries(tables).filter(([, exists]) => !exists).map(([name]) => name);
      schemaReady = missingTables.length === 0;
    } catch (error) {
      databaseError = error.code || 'CONNECTION_ERROR';
      console.error('health database:', databaseError, error.message);
    }
  }

  const ready = databaseConnected && schemaReady && configuration.jwtConfigured;
  return json(ready ? 200 : 503, {
    service: 'Telepronto',
    status: ready ? 'ready' : 'configuration_required',
    databaseConnected,
    schemaReady,
    missingTables,
    databaseError,
    configuration,
    note: 'Este diagnóstico nunca retorna valores de chaves ou senhas.'
  });
};
