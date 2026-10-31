const bcrypt = require('bcryptjs');
const { db } = require('./lib/db');
const { tokenFor, userFromEvent, json, body } = require('./lib/auth');

exports.handler = async event => {
  try {
    const pool = db();
    if (event.httpMethod === 'GET') {
      const auth = userFromEvent(event);
      if (!auth) return json(401, { error: 'Faça login novamente.' });
      const result = await pool.query('SELECT id, email, created_at FROM users WHERE id=$1', [auth.sub]);
      if (!result.rowCount) return json(401, { error: 'Conta não encontrada.' });
      return json(200, { user: result.rows[0] });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
    const data = body(event);
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(400, { error: 'Informe um e-mail válido.' });
    if (password.length < 8 || password.length > 128) return json(400, { error: 'A senha deve ter entre 8 e 128 caracteres.' });
    if (data.action === 'register') {
      const hash = await bcrypt.hash(password, 12);
      try {
        const result = await pool.query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at', [email, hash]);
        const user = result.rows[0];
        await pool.query('INSERT INTO wallets(user_id,balance) VALUES($1,0) ON CONFLICT(user_id) DO NOTHING', [user.id]);
        return json(201, { token: tokenFor(user), user });
      } catch (e) {
        if (e.code === '23505') return json(409, { error: 'Este e-mail já possui cadastro.' });
        throw e;
      }
    }
    if (data.action === 'login') {
      const result = await pool.query('SELECT id,email,password_hash,created_at FROM users WHERE email=$1', [email]);
      if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) return json(401, { error: 'E-mail ou senha incorretos.' });
      const user = result.rows[0];
      return json(200, { token: tokenFor(user), user: { id:user.id,email:user.email,created_at:user.created_at } });
    }
    return json(400, { error: 'Ação inválida.' });
  } catch (e) { console.error('auth:', e.message); return json(500, { error: 'Não foi possível concluir a autenticação. Confira a configuração do banco.' }); }
};
