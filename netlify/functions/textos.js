const { getStore } = require('@netlify/blobs');

const store = getStore('teleprompter-textos');

function nomeSeguro(nome) {
    return String(nome || '')
        .replace(/[^a-zA-Z0-9À-ÿ _-]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function resposta(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body)
    };
}

exports.handler = async event => {
    try {
        const ultimoSegmento = event.path.split('/').filter(Boolean).pop();
        const nome = ultimoSegmento === 'textos' ? '' : nomeSeguro(ultimoSegmento);

        if (event.httpMethod === 'GET' && !nome) {
            const resultado = await store.list();
            const nomes = (resultado.blobs || []).map(blob => blob.key).sort();
            return resposta(200, nomes);
        }

        if (event.httpMethod === 'POST') {
            const dados = JSON.parse(event.body || '{}');
            const nomeSalvo = nomeSeguro(dados.nome);
            const texto = String(dados.texto || '');
            if (!nomeSalvo || !texto.trim()) return resposta(400, { erro: 'Nome e texto são obrigatórios.' });
            await store.set(nomeSalvo, texto, { metadata: { tipo: 'roteiro' } });
            return resposta(201, { nome: nomeSalvo });
        }

        if (!nome) return resposta(400, { erro: 'Nome inválido.' });

        if (event.httpMethod === 'GET') {
            const texto = await store.get(nome);
            if (texto === null) return resposta(404, { erro: 'Texto não encontrado.' });
            return resposta(200, { nome, texto });
        }

        if (event.httpMethod === 'DELETE') {
            await store.delete(nome);
            return resposta(200, { ok: true });
        }

        return resposta(405, { erro: 'Método não permitido.' });
    } catch (erro) {
        return resposta(500, { erro: erro.message });
    }
};
