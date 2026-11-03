const { randomUUID } = require('crypto');
const { db } = require('./lib/db');
const { userFromEvent, json, body } = require('./lib/auth');

const PACKAGES = {
  BRL: [{id:'br-10',videos:10,amount:1.00},{id:'br-20',videos:20,amount:2.00},{id:'br-100',videos:100,amount:10.00},{id:'br-500',videos:500,amount:50.00}],
  USD: [{id:'us-10',videos:10,amount:1.00},{id:'us-20',videos:20,amount:2.00},{id:'us-100',videos:100,amount:10.00},{id:'us-500',videos:500,amount:50.00}]
};
const money = n => Number(n).toFixed(2);

async function sumup(path, options={}) {
  const apiKey = String(process.env.SUMUP_API_KEY || '').trim();
  if (!apiKey) throw new Error('SUMUP_API_KEY não configurada no Netlify.');
  if (/^sup_pk_/i.test(apiKey)) {
    throw new Error('A SUMUP_API_KEY contém uma chave pública (sup_pk_). Configure uma chave secreta de API (sup_sk_) no servidor.');
  }

  const response = await fetch('https://api.sumup.com' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || data.message || data.error_message || 'Falha na comunicação com SumUp (' + response.status + ').');
    error.statusCode = response.status;
    error.sumupCode = data.error_code || data.errorCode || data.type || null;
    error.traceId = data.trace_id || null;
    throw error;
  }
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

    if (data.action === 'pix') {
      if (data.currency === 'USD') return json(400,{error:'PIX está disponível somente para compras em reais.'});
      const pack = PACKAGES.BRL.find(p=>p.id===data.packageId);
      if (!pack) return json(400,{error:'Pacote inválido.'});
      const merchant = String(process.env.SUMUP_MERCHANT_CODE || '').trim();
      if (!merchant) return json(503,{error:'SUMUP_MERCHANT_CODE não configurado no Netlify.'});
      const appUrl = (process.env.APP_URL || 'https://telepronto.netlify.app').replace(/\\/$/,'');
      const reference = 'tp-' + randomUUID();
      await pool.query("INSERT INTO payments(user_id,reference,package_id,credits,amount,currency,status) VALUES($1,$2,$3,$4,$5,'BRL','pending')",[auth.sub,reference,pack.id,pack.videos,pack.amount]);
      try {
        const checkout = await sumup('/v0.1/checkouts',{method:'POST',body:JSON.stringify({
          checkout_reference:reference, amount:pack.amount, currency:'BRL',
          merchant_code:merchant, description:'Telepronto - pacote '+pack.videos+' vídeos',
          return_url:appUrl+'/.netlify/functions/webhook',
          redirect_url:appUrl+'/?payment=return'
        })});
        if (!checkout.id) throw new Error('A SumUp não retornou o identificador do checkout.');

        await pool.query('UPDATE payments SET checkout_id=$1 WHERE reference=$2',[checkout.id,reference]);

        // A lista de APMs é consultada no endpoint do estabelecimento, não dentro do checkout.
        const methods = await sumup('/v0.1/checkouts/'+encodeURIComponent(checkout.id)+'/payment-methods');
        const available = (methods.items || methods.available_payment_methods || []).map(x=>String(x.id || '').toLowerCase());
        const pixMethod = available.includes('pix') ? 'pix' : available.includes('qr_code_pix') ? 'qr_code_pix' : null;
        if (!pixMethod) {
          await pool.query("UPDATE payments SET status='failed' WHERE reference=$1",[reference]);
          return json(409,{error:'A SumUp não disponibilizou PIX para este estabelecimento/valor. A conta precisa ter PIX online habilitado.'});
        }

        const processed = await sumup('/v0.1/checkouts/'+encodeURIComponent(checkout.id),{
          method:'PUT',body:JSON.stringify({payment_type:pixMethod})
        });
        const artifacts = processed[pixMethod]?.artefacts || processed[pixMethod]?.artifacts ||
          processed.pix?.artefacts || processed.qr_code_pix?.artefacts || [];
        const code = artifacts.find(x=>x.name==='code' && x.content)?.content ||
          processed[pixMethod]?.code || processed[pixMethod]?.pix_code || ''; 
        if (!code) throw new Error('A SumUp não retornou o código PIX copia e cola. Verifique se PIX online está habilitado na conta.');

        const QRCode = require('qrcode');
        const qrImage = await QRCode.toDataURL(code,{errorCorrectionLevel:'M',margin:2,width:320});
        return json(200,{method:pixMethod,reference,checkoutId:checkout.id,credits:pack.videos,amount:money(pack.amount),currency:'BRL',pixCode:code,qrImage,status:processed.status || 'PENDING'});
      } catch(error) {
        await pool.query("UPDATE payments SET status='failed' WHERE reference=$1 AND status='pending'",[reference]).catch(()=>{});
        throw error;
      }
    }

    const currency = data.currency === 'USD' ? 'USD' : 'BRL';
    const pack = PACKAGES[currency].find(p=>p.id===data.packageId);
    if (!pack) return json(400,{error:'Pacote inválido.'});
    const merchant = process.env.SUMUP_MERCHANT_CODE;
    const appUrl = (process.env.APP_URL || 'https://telepronto.netlify.app').replace(/\/$/,'');
    if (!merchant) return json(503,{error:'SUMUP_MERCHANT_CODE não configurado no Netlify.'});

    const reference = 'tp-' + randomUUID();
    await pool.query('INSERT INTO payments(user_id,reference,package_id,credits,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6,\'pending\')',[auth.sub,reference,pack.id,pack.videos,pack.amount,currency]);

    let checkout;
    try {
      checkout = await sumup('/v0.1/checkouts',{method:'POST',body:JSON.stringify({
        checkout_reference:reference,
        amount:pack.amount,
        currency,
        merchant_code:merchant,
        description:'Telepronto - pacote '+pack.videos+' vídeos',
        return_url:appUrl+'/.netlify/functions/webhook',
        redirect_url:appUrl+'/?payment=return',
        hosted_checkout:{enabled:true}
      })});
    } catch (error) {
      // Não deixar uma tentativa sem checkout real presa como pendente.
      await pool.query("UPDATE payments SET status='failed' WHERE reference=$1 AND status='pending'",[reference]);
      throw error;
    }

    if (!checkout.id || !checkout.hosted_checkout_url) {
      await pool.query("UPDATE payments SET status='failed' WHERE reference=$1 AND status='pending'",[reference]);
      throw new Error('A SumUp respondeu sem checkout_id ou link hospedado; tentativa marcada como falha.');
    }

    await pool.query('UPDATE payments SET checkout_id=$1 WHERE reference=$2',[checkout.id,reference]);
    return json(200,{checkoutUrl:checkout.hosted_checkout_url,reference,credits:pack.videos,amount:money(pack.amount),currency});
  } catch(e) {
    console.error('billing:', JSON.stringify({
      message: e.message,
      status: e.statusCode || null,
      code: e.sumupCode || e.code || null,
      trace_id: e.traceId || null
    }));

    if (e.statusCode === 401) {
      return json(502,{error:'A SumUp não autorizou a chave configurada no servidor (HTTP 401). Confira se SUMUP_API_KEY é uma chave secreta ativa da conta correta; não use a chave pública sup_pk_.'});
    }
    if (e.statusCode === 403) {
      return json(502,{error:'A chave foi reconhecida, mas a conta não tem permissão para criar checkouts (HTTP 403). Verifique as permissões de pagamentos/checkouts na SumUp.'});
    }
    return json(500,{error:e.message || 'Erro ao processar a operação.'});
  }
};
