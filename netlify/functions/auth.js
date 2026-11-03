const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('./lib/db');
const { tokenFor, userFromEvent, json, body } = require('./lib/auth');
const { isValidEmail } = require('./lib/validation');

async function verifyPassword(password, storedHash) {
  const value = String(storedHash || '');
  if (value.startsWith('pbkdf2$')) {
    const parts = value.split('$');
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
    const salt = Buffer.from(parts[2], 'base64url');
    const expected = Buffer.from(parts[3], 'base64url');
    const actual = await new Promise((resolve, reject) =>
      crypto.pbkdf2(password, salt, iterations, expected.length, 'sha256',
        (error, key) => error ? reject(error) : resolve(key))
    );
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  return bcrypt.compare(password, value);
}

function serviceError(error) {
  const code = error && error.code;
  if (code === '42P01' || code === '42703') {
    return json(503, { error: 'O PostgreSQL está conectado, mas as tabelas do Telepronto não estão prontas. Execute database/schema.sql no banco configurado.' });
  }
  if (['28P01', '3D000', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '08000', '08003', '08006'].includes(code)) {
    return json(503, { error: 'Não foi possível conectar ao PostgreSQL. Confira a conexão DATABASE_URL no Netlify.' });
  }
  console.error('auth:', code || 'sem código', error && error.message);
  return json(500, { error: 'Não foi possível concluir a autenticação. Tente novamente e confira o diagnóstico do serviço.' });
}

exports.handler = async event => {
  let client;
  try {
    if (!process.env.DATABASE_URL) return json(503, { error: 'DATABASE_URL não está configurada no ambiente deste deploy do Netlify.' });
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      return json(503, { error: 'JWT_SECRET não está configurada corretamente no ambiente deste deploy do Netlify.' });
    }

    if (event.httpMethod === 'GET') {
      const pool = db();
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
      const auth = userFromEvent(event);
      if (!auth) return json(401, { error: 'Faça login novamente.' });
      const result = await pool.query('SELECT id, email, role, created_at FROM users WHERE id=$1', [auth.sub]);
      if (!result.rowCount) return json(401, { error: 'Conta não encontrada.' });
      return json(200, { user: result.rows[0] });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
    const data = body(event);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');

    if (!isValidEmail(email)) return json(400, { error: 'Informe um e-mail válido.' });
    if (password.length < 8 || password.length > 128) {
      return json(400, { error: 'A senha deve ter entre 8 e 128 caracteres.' });
    }

    // Só inicializa/acessa o PostgreSQL depois de validar os dados recebidos.
    const pool = db();
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");

    if (data.action === 'register') {
      client = await pool.connect();
      try {
        await client.query('BEGIN');
        const hash = await bcrypt.hash(password, 12);
        const result = await client.query(
          'INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at',
          [email, hash]
        );
        const user = result.rows[0];
        await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [user.id]);
        await client.query('COMMIT');
        return json(201, { token: tokenFor(user), user });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') return json(409, { error: 'Este e-mail já possui cadastro.' });
        throw error;
      } finally {
        client.release();
        client = null;
      }
    }

    if (data.action === 'login') {
      const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
      let result = await pool.query('SELECT id,email,password_hash,role,created_at FROM users WHERE email=$1', [email]);
      if (adminEmail && email === adminEmail) {
        const adminPassword = String(process.env.ADMIN_PASSWORD || '');
        if (adminPassword.length < 8 || password !== adminPassword) {
          return json(401, { error: 'E-mail ou senha incorretos.' });
        }
        const hash = await bcrypt.hash(adminPassword, 12);
        if (!result.rowCount) {
          result = await pool.query(
            "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id,email,password_hash,role,created_at",
            [email, hash]
          );
        } else {
          result = await pool.query(
            "UPDATE users SET password_hash=$2, role='admin' WHERE id=$1 RETURNING id,email,password_hash,role,created_at",
            [result.rows[0].id, hash]
          );
        }
      } else if (!result.rowCount || !(await verifyPassword(password, result.rows[0].password_hash))) {
        return json(401, { error: 'E-mail ou senha incorretos.' });
      }
      const user = result.rows[0];
      await pool.query('INSERT INTO wallets(user_id,balance) VALUES($1,0) ON CONFLICT(user_id) DO NOTHING', [user.id]);
      return json(200, {
        token: tokenFor(user),
        user: { id: user.id, email: user.email, role: user.role || 'user', isAdmin: user.role === 'admin', created_at: user.created_at }
      });
    }

    return json(400, { error: 'Ação inválida.' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return serviceError(error);
  } finally {
    if (client) client.release();
  }
};
