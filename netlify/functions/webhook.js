const { db } = require('./lib/db');
const { json } = require('./lib/auth');
exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405,{error:'Método não permitido.'});
  let client;
  try {
    const payload = JSON.parse(event.body || '{}');
    const checkoutId = String(payload.id || '');
    if (!checkoutId) return json(200,{ok:true,ignored:true});
    if (!process.env.SUMUP_API_KEY) throw new Error('SUMUP_API_KEY não configurada.');
    const response = await fetch('https://api.sumup.com/v0.1/checkouts/'+encodeURIComponent(checkoutId),{headers:{Authorization:'Bearer '+process.env.SUMUP_API_KEY}});
    const checkout = await response.json();
    if (!response.ok) throw new Error('Não foi possível confirmar o checkout na SumUp.');
    if (checkout.status !== 'PAID') return json(200,{ok:true,pending:true});
    const pool = db();
    client = await pool.connect();
    await client.query('BEGIN');
    const payment = await client.query('SELECT * FROM payments WHERE checkout_id=$1 FOR UPDATE',[checkoutId]);
    if (!payment.rowCount) { await client.query('ROLLBACK'); return json(200,{ok:true,unknown:true}); }
    const p = payment.rows[0];
    if (Number(checkout.amount).toFixed(2)!==Number(p.amount).toFixed(2) || checkout.currency!==p.currency || checkout.checkout_reference!==p.reference) {
      await client.query("UPDATE payments SET status='review' WHERE id=$1",[p.id]);
      await client.query('COMMIT');
      return json(200,{ok:true,review:true});
    }
    if (p.status !== 'paid') {
      await client.query("UPDATE payments SET status='paid',paid_at=NOW() WHERE id=$1",[p.id]);
      await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance=wallets.balance+EXCLUDED.balance,updated_at=NOW()',[p.user_id,p.credits]);
      await client.query("INSERT INTO credit_ledger(user_id,delta,reason,reference) VALUES($1,$2,'purchase',$3) ON CONFLICT(user_id,reference) DO NOTHING",[p.user_id,p.credits,p.reference]);
    }
    await client.query('COMMIT');
    return json(200,{ok:true});
  } catch(e) {
    if (client) await client.query('ROLLBACK').catch(()=>{});
    console.error('webhook:',e.message);
    return json(500,{error:'Falha ao confirmar pagamento.'});
  } finally { if(client) client.release(); }
};
