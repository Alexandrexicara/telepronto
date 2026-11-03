const { db } = require('./lib/db');
const { userFromEvent, json, body } = require('./lib/auth');

async function requireAdmin(event, pool) {
  const auth = userFromEvent(event);
  if (!auth) return { error: json(401, { error: 'Faça login para continuar.' }) };
  const result = await pool.query('SELECT id,email,role FROM users WHERE id=$1', [auth.sub]);
  const user = result.rows[0];
  if (!user || user.role !== 'admin') return { error: json(403, { error: 'Acesso exclusivo do administrador.' }) };
  return { user };
}

exports.handler = async event => {
  try {
    const pool = db();
    const access = await requireAdmin(event, pool);
    if (access.error) return access.error;

    if (event.httpMethod === 'GET') {
      const [stats, users, payments] = await Promise.all([
        pool.query(`SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users WHERE role='admin') AS total_admins,
          (SELECT COUNT(*)::int FROM payments WHERE status='paid') AS paid_payments,
          (SELECT COALESCE(SUM(amount),0)::numeric(12,2) FROM payments WHERE status='paid' AND currency='BRL') AS revenue_brl,
          (SELECT COALESCE(SUM(balance),0)::int FROM wallets) AS available_credits`),
        pool.query(`SELECT u.id,u.email,u.role,u.created_at,COALESCE(w.balance,0)::int AS balance
          FROM users u LEFT JOIN wallets w ON w.user_id=u.id ORDER BY u.created_at DESC LIMIT 100`),
        pool.query(`SELECT p.id,p.user_id,u.email,p.reference,p.package_id,p.credits,p.amount,p.currency,p.status,p.created_at,p.paid_at
          FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 100`)
      ]);
      return json(200, { admin: access.user, stats: stats.rows[0], users: users.rows, payments: payments.rows });
    }

    if (event.httpMethod === 'POST') {
      const data = body(event);
      if (data.action === 'add_credits') {
        const userId = String(data.userId || '');
        const credits = Number(data.credits);
        if (!/^[0-9a-f-]{36}$/i.test(userId) || !Number.isInteger(credits) || credits < 1 || credits > 100000) {
          return json(400, { error: 'Usuário ou quantidade de créditos inválida.' });
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const wallet = await client.query(
            'INSERT INTO wallets(user_id,balance) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance,updated_at=NOW() RETURNING balance',
            [userId, credits]
          );
          const reference = 'admin-credit-' + require('crypto').randomUUID();
          await client.query(
            'INSERT INTO credit_ledger(user_id,delta,reason,reference) VALUES($1,$2,$3,$4)',
            [userId, credits, 'admin_adjustment:' + access.user.email, reference]
          );
          await client.query('COMMIT');
          return json(200, { ok: true, balance: wallet.rows[0].balance });
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
      return json(400, { error: 'Ação administrativa inválida.' });
    }
    return json(405, { error: 'Método não permitido.' });
  } catch (error) {
    console.error('admin:', error.code || '', error.message);
    return json(500, { error: 'Não foi possível carregar o painel administrativo.' });
  }
};
