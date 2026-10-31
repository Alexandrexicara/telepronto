const { db } = require('./lib/db');
const { json } = require('./lib/auth');

// SumUp espera uma confirmação 2xx sem corpo para encerrar a entrega do webhook.
const ack = () => ({ statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' });

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

  let client;
  try {
    const payload = JSON.parse(event.body || '{}');
    // A SumUp pode introduzir novos eventos; ignoramos os que não são mudança de checkout.
    if (payload.event_type && payload.event_type !== 'CHECKOUT_STATUS_CHANGED') {
      return ack();
    }

    const checkoutId = String(payload.id || '');
    if (!checkoutId) return ack();
    if (!process.env.SUMUP_API_KEY || !process.env.SUMUP_MERCHANT_CODE) {
      throw new Error('Credenciais SumUp não configuradas.');
    }

    // Nunca confiar no conteúdo do webhook: consultar o checkout diretamente na SumUp.
    const response = await fetch(
      'https://api.sumup.com/v0.1/checkouts/' + encodeURIComponent(checkoutId),
      { headers: { Authorization: 'Bearer ' + process.env.SUMUP_API_KEY } }
    );
    const checkout = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Não foi possível confirmar o checkout na SumUp.');

    const pool = db();
    if (checkout.status !== 'PAID' && !['FAILED', 'EXPIRED'].includes(checkout.status)) {
      return ack();
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const payment = await client.query(
      'SELECT * FROM payments WHERE checkout_id = $1 FOR UPDATE',
      [checkoutId]
    );
    if (!payment.rowCount) {
      await client.query('ROLLBACK');
      return ack();
    }

    const p = payment.rows[0];

    if (checkout.status === 'FAILED' || checkout.status === 'EXPIRED') {
      if (p.status === 'pending') {
        await client.query(
          "UPDATE payments SET status = 'failed' WHERE id = $1",
          [p.id]
        );
      }
      await client.query('COMMIT');
      return ack();
    }

    const validAmount = Number.isFinite(Number(checkout.amount)) &&
      Number(checkout.amount).toFixed(2) === Number(p.amount).toFixed(2);
    const validCheckout =
      validAmount &&
      checkout.currency === p.currency &&
      checkout.checkout_reference === p.reference &&
      checkout.merchant_code === process.env.SUMUP_MERCHANT_CODE;

    if (!validCheckout) {
      await client.query(
        "UPDATE payments SET status = 'review' WHERE id = $1 AND status <> 'paid'",
        [p.id]
      );
      await client.query('COMMIT');
      return ack();
    }

    if (p.status !== 'paid') {
      // O ledger é a trava de idempotência: só credita a carteira se inserir o lançamento.
      const ledger = await client.query(
        "INSERT INTO credit_ledger(user_id, delta, reason, reference) VALUES($1, $2, 'purchase', $3) ON CONFLICT(user_id, reference) DO NOTHING RETURNING id",
        [p.user_id, p.credits, p.reference]
      );

      if (ledger.rowCount) {
        await client.query(
          'INSERT INTO wallets(user_id, balance) VALUES($1, $2) ON CONFLICT(user_id) DO UPDATE SET balance = wallets.balance + EXCLUDED.balance, updated_at = NOW()',
          [p.user_id, p.credits]
        );
      }

      await client.query(
        "UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = $1",
        [p.id]
      );
    }

    await client.query('COMMIT');
    return ack();
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('webhook:', error.code || '', error.message);
    return json(500, { error: 'Falha ao confirmar pagamento.' });
  } finally {
    if (client) client.release();
  }
};
