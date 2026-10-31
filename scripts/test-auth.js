const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
const authModulePath = path.resolve(__dirname, '../netlify/functions/auth.js');
const calls = [];
let duplicateEmail = false;
const user = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'celio@example.com',
  created_at: '2026-10-31T00:00:00.000Z',
  password_hash: 'hash:senha12345'
};

const client = {
  async query(sql) {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO users')) {
      if (duplicateEmail) {
        const error = new Error('duplicate key');
        error.code = '23505';
        throw error;
      }
      return { rows: [{ ...user }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  },
  release() { calls.push('RELEASE'); }
};

const pool = {
  async connect() { return client; },
  async query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT id,email,password_hash')) {
      return { rows: [{ ...user }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  }
};

Module._load = function(request, parent, isMain) {
  if (parent && parent.filename === authModulePath) {
    if (request === 'bcryptjs') {
      return {
        hash: async password => 'hash:' + password,
        compare: async (password, hash) => hash === 'hash:' + password
      };
    }
    if (request === './lib/db') return { db: () => pool };
    if (request === './lib/auth') {
      return {
        tokenFor: () => 'jwt-test-token',
        userFromEvent: () => null,
        json: (statusCode, data) => ({
          statusCode,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }),
        body: event => JSON.parse(event.body || '{}')
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

process.env.DATABASE_URL = 'postgres://test';
process.env.JWT_SECRET = 'x'.repeat(40);
const { handler } = require(authModulePath);

(async () => {
  let response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'register', email: 'CELIO@example.com', password: 'senha12345' })
  });
  assert.equal(response.statusCode, 201, 'cadastro válido deve criar a conta');
  assert.match(response.body, /jwt-test-token/);
  assert(calls.includes('BEGIN'), 'cadastro deve abrir transação');
  assert(calls.includes('COMMIT'), 'cadastro deve confirmar transação');
  assert(calls.includes('RELEASE'), 'conexão deve ser liberada');

  calls.length = 0;
  duplicateEmail = true;
  response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'register', email: 'celio@example.com', password: 'senha12345' })
  });
  assert.equal(response.statusCode, 409, 'e-mail duplicado deve retornar conflito');
  assert(calls.includes('ROLLBACK'), 'cadastro duplicado deve desfazer transação');

  calls.length = 0;
  duplicateEmail = false;
  response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'register', email: 'email-invalido', password: 'senha12345' })
  });
  assert.equal(response.statusCode, 400, 'e-mail inválido deve ser recusado');
  assert.equal(calls.length, 0, 'e-mail inválido não deve acessar o banco');

  calls.length = 0;
  response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'login', email: 'celio@example.com', password: 'senha12345' })
  });
  assert.equal(response.statusCode, 200, 'login correto deve autenticar');
  assert.match(response.body, /jwt-test-token/);

  response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'login', email: 'celio@example.com', password: 'senha-errada' })
  });
  assert.equal(response.statusCode, 401, 'senha incorreta deve ser recusada');

  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'register', email: 'celio@example.com', password: 'senha12345' })
  });
  assert.equal(response.statusCode, 503, 'ausência de DATABASE_URL deve ser diagnosticada');
  process.env.DATABASE_URL = originalDatabaseUrl;

  console.log('OK: 6 cenários de cadastro/login aprovados com banco simulado.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
