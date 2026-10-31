const jwt = require('jsonwebtoken');
function tokenFor(user) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d', issuer: 'telepronto' });
}
function userFromEvent(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !process.env.JWT_SECRET) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'telepronto' }); } catch { return null; }
}
function json(statusCode, data) {
  return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) };
}
function body(event) {
  try { return JSON.parse(event.body || '{}'); } catch { return {}; }
}
module.exports = { tokenFor, userFromEvent, json, body };
