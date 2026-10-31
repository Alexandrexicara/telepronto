const { randomUUID } = require('crypto');
const { db } = require('./lib/db');
const { userFromEvent, json, body } = require('./lib/auth');

const PACKAGES = {
  BRL: [{id:'br-10',videos:10,amount:1.00},{id:'br-20',videos:20,amount:2.00},{id:'br-100',videos:100,amount:10.00},{id:'br-500',videos:500,amount:50.00}],
  USD: [{id:'us-10',videos:10,amount:1.00},{id:'us-20',videos:20,amount:2.00},{id:'us-100',videos:100,amount:10.00},{id:'us-500',videos:500,amount:50.00}]
};
const money = n => Number(n).toFixed(2);
async function sumup(path, options={}) {
  if (!process.env.SUMUP_API_KEY) throw new Error('SUMUP_API_KEY não configurada.');
  const response = await fetch('https://api.sumup.com' + path, { ...options, headers: { Authorization: 'Bearer ' + process.env.SUMUP_API_KEY, 'Content-Type':'application/json', ...(options.headers||{}) } });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.detail || data.message || 'Falha na comunicação com SumUp ('+response.status+').');
  return data;
}
exports.handler = async event => {
  try {
    const auth = userFromEvent(event);
    if (!auth) return json(401,{error:'Faça login para acessar sua carteira.'});
    const pool = db();
    if (event.httpMethod === 'GET') {
      const result = await pool.query('SELECT balance FROM wallets WHERE user_id=$1',[auth.sub]);
      return json(200,{balance: result.rows[0]?.balance || 0, pricePerVideo:0.10, packages:PACKAGES});
    }
    if (event.httpMethod !== 'POST') return json(405,{error:'Método não permitido.'});
    const data = body(event);
    if (data.action === 'consume') {
      const key = String(data.recordingId || '');
      if (!/^[a-zA-Z0-9-]{16,80}$/.test(key)) return json(400,{error:'Identificador de gravação inválido.'});
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const prior = await client.query('SELECT id FROM credit_ledger WHERE user_id=$1 AND reference=$2',[auth.sub,key]);
        if (prior.rowCount) { await client.query('COMMIT'); return json(200,{ok:true,alreadyProcessed:true}); }
        const debit = await client.query('UPDATE wallets SET balance=balance-1,updated_at=NOW() WHERE user_id=$1 AND balance>0 RETURNING balance',[auth.sub]);
        if (!debit.rowCount) { await client.query('ROLLBACK'); return json(402,{error:'Você está sem créditos. Escolha um pacote para continuar.'}); }
        await client.query("INSERT INTO credit_ledger(user_id,delta,reason,reference) VALUES($1,-1,'video_recording',$2)",[auth.sub,key]);
        await client.query('COMMIT');
        return json(200,{ok:true,balance:debit.rows[0].balance});
      } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    }
    const currency = data.currency === 'USD' ? 'USD' : 'BRL';
    const pack = PACKAGES[currency].find(p=>p.id===data.packageId);
    if (!pack) return json(400,{error:'Pacote inválido.'});
    const merchant = process.env.SUMUP_MERCHANT_CODE;
    const appUrl = (process.env.APP_URL || 'https://telepronto.netlify.app').replace(/\/$/,'');
    if (!merchant) return json(503,{error:'SUMUP_MERCHANT_CODE não configurado no Netlify.'});
    const reference = 'tp-' + randomUUID();
    await pool.query('INSERT INTO payments(user_id,reference,package_id,credits,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6,\'pending\')',[auth.sub,reference,pack.id,pack.videos,pack.amount,currency]);
    const checkout = await sumup('/v0.1/checkouts',{method:'POST',body:JSON.stringify({
      checkout_reference:reference, amount:pack.amount, currency, merchant_code:merchant,
      description:'Telepronto - pacote '+pack.videos+' vídeos',
      return_url:appUrl+'/.netlify/functions/webhook',
      redirect_url:appUrl+'/?payment=return',
      hosted_checkout:{enabled:true}
    })});
    await pool.query('UPDATE payments SET checkout_id=$1 WHERE reference=$2',[checkout.id,reference]);
    if (!checkout.hosted_checkout_url) throw new Error('SumUp não retornou o link de pagamento.');
    return json(200,{checkoutUrl:checkout.hosted_checkout_url,reference,credits:pack.videos,amount:money(pack.amount),currency});
  } catch(e) { console.error('billing:',e.message); return json(500,{error:e.message || 'Erro ao processar a operação.'}); }
};
