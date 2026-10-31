const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
const webhookPath = path.resolve(__dirname, '../netlify/functions/webhook.js');
let payment;
let ledgerInserted;
let balance;
let checkout;
const calls = [];

function reset(overrides = {}) {
  payment = {
    id: 'payment-1',
    user_id: 'user-1',
    reference: 'tp-reference-123',
    checkout_id: 'checkout-123',
    credits: 10,
    amount: '1.00',
    currency: 'BRL',
    status: 'pending',
    ...overrides
  };
  ledgerInserted = false;
  balance = 0;
  calls.length = 0;
  checkout = {
    id: 'checkout-123',
    status: 'PAID',
    amount: 1,
    currency: 'BRL',
    checkout_reference: 'tp-reference-123',
    merchant_code: 'MERCHANT-1'
  };
}

const client = {
  async query(sql, params = []) {
    calls.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT * FROM payments')) {
      return { rowCount: 1, rows: [{ ...payment }] };
    }
    if (sql.includes('INSERT INTO credit_ledger')) {
      if (ledgerInserted) return { rowCount: 0, rows: [] };
      ledgerInserted = true;
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
    if (sql.includes('INSERT INTO wallets')) {
      balance += Number(params[1]);
      return { rowCount: 1, rows: [{ balance }] };
    }
    if (sql.includes("SET status = 'paid'")) payment.status = 'paid';
    if (sql.includes("SET status = 'failed'")) payment.status = 'failed';
    if (sql.includes("SET status = 'review'")) payment.status = 'review';
    return { rowCount: 1, rows: [] };
  },
  release() { calls.push('RELEASE'); }
};

const pool = { async connect() { return client; } };
Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === webhookPath) {
    if (request === './lib/db') return { db: () => pool };
    if (request === './lib/auth') {
      return { json: (statusCode, data) => ({ statusCode, body: JSON.stringify(data) }) };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SUMUP_API_KEY = 'test-api-key';
process.env.SUMUP_MERCHANT_CODE = 'MERCHANT-1';
global.fetch = async () => ({
  ok: true,
  async json() { return { ...checkout }; }
});

const { handler } = require(webhookPath);
const event = () => ({
  httpMethod: 'POST',
  body: JSON.stringify({ event_type: 'CHECKOUT_STATUS_CHANGED', id: 'checkout-123' })
});

(async () => {
  reset();
  let response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(payment.status, 'paid');
  assert.equal(balance, 10, 'pagamento aprovado deve liberar 10 créditos');
  assert.equal(ledgerInserted, true);

  response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(balance, 10, 'webhook repetido não pode duplicar créditos');

  reset();
  checkout.merchant_code = 'OUTRO-MERCHANT';
  response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(payment.status, 'review');
  assert.equal(balance, 0, 'checkout de outro estabelecimento não pode creditar');

  reset();
  checkout.status = 'FAILED';
  response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(payment.status, 'failed');
  assert.equal(balance, 0);

  reset();
  checkout.status = 'PENDING';
  response = await handler(event());
  assert.equal(response.statusCode, 200);
  assert.equal(payment.status, 'pending');
  assert.equal(balance, 0);

  console.log('OK: 4 cenários do webhook SumUp aprovados com API e PostgreSQL simulados.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
