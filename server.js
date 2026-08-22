const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TEXTS_DIR = path.join(ROOT, 'textos');
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

fs.mkdirSync(TEXTS_DIR, { recursive: true });

function nomeSeguro(nome) {
    return nome.trim().replace(/[^a-zA-Z0-9À-ÿ _-]/g, '-').replace(/\s+/g, ' ').slice(0, 80);
}
function responder(res, status, dados) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(dados));
}
function lerCorpo(req) {
    return new Promise((resolve, reject) => {
        let corpo = '';
        req.on('data', parte => { corpo += parte; if (corpo.length > 2_000_000) reject(new Error('Texto muito grande')); });
        req.on('end', () => resolve(JSON.parse(corpo || '{}')));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (url.pathname === '/api/textos' && req.method === 'GET') {
            const nomes = fs.readdirSync(TEXTS_DIR).filter(nome => nome.endsWith('.txt')).map(nome => nome.slice(0, -4)).sort();
            return responder(res, 200, nomes);
        }
        if (url.pathname === '/api/textos' && req.method === 'POST') {
            const dados = await lerCorpo(req);
            const nome = nomeSeguro(String(dados.nome || ''));
            const texto = String(dados.texto || '');
            if (!nome || !texto.trim()) return responder(res, 400, { erro: 'Nome e texto são obrigatórios.' });
            fs.writeFileSync(path.join(TEXTS_DIR, `${nome}.txt`), texto, 'utf8');
            return responder(res, 201, { nome });
        }
        if (url.pathname.startsWith('/api/textos/') && req.method === 'GET') {
            const nome = nomeSeguro(decodeURIComponent(url.pathname.slice('/api/textos/'.length)));
            const arquivo = path.join(TEXTS_DIR, `${nome}.txt`);
            if (!fs.existsSync(arquivo)) return responder(res, 404, { erro: 'Texto não encontrado.' });
            return responder(res, 200, { nome, texto: fs.readFileSync(arquivo, 'utf8') });
        }
        if (url.pathname.startsWith('/api/textos/') && req.method === 'DELETE') {
            const nome = nomeSeguro(decodeURIComponent(url.pathname.slice('/api/textos/'.length)));
            const arquivo = path.join(TEXTS_DIR, `${nome}.txt`);
            if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
            return responder(res, 200, { ok: true });
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, { erro: 'Método não permitido.' });
        let arquivo = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
        if (!arquivo.startsWith(ROOT) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) return responder(res, 404, { erro: 'Página não encontrada.' });
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(arquivo)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(arquivo).pipe(res);
    } catch (erro) {
        responder(res, 500, { erro: erro.message });
    }
});

server.on('error', erro => {
    if (erro.code === 'EADDRINUSE') {
        console.error(`A porta ${PORT} já está em uso. Use o servidor existente em http://localhost:${PORT} ou execute: $env:PORT=3001; npm start`);
        process.exitCode = 1;
        return;
    }
    throw erro;
});

server.listen(PORT, () => console.log(`Teleprompter em http://localhost:${PORT}`));
