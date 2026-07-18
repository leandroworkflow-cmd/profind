// api/buscar.js
// Função serverless do Vercel — o motor de busca de verdade.
//
// Fluxo: cliente digita → busca AO VIVO na web (Tavily) → extrai e estrutura
// os profissionais encontrados (Groq) → responde. Sem lista de URL manual,
// sem robô rodado à parte. Isso é o "Google dos profissionais" de verdade.
//
// Resultados também ficam salvos em resultados.json (cache), então a
// PRÓXIMA busca pela mesma categoria+região é instantânea e não gasta
// API de novo.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MODELO_GROQ = "llama-3.3-70b-versatile";

function normalizar(txt) {
  return (txt || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function buscarNaWeb(q, tavilyKey) {
  const resposta = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: `${q} contato telefone whatsapp`,
      search_depth: "basic",
      max_results: 8,
    }),
  });

  if (!resposta.ok) throw new Error(`Tavily respondeu ${resposta.status}`);
  const dados = await resposta.json();
  return dados.results || []; // [{ title, url, content }, ...]
}

async function estruturarComGroq(q, achados, groqKey) {
  const prompt = `Você recebe um pedido de cliente e uma lista de páginas web
encontradas numa busca. Identifique quais páginas realmente são de um
profissional autônomo ou pequeno negócio prestador do serviço pedido — e
estruture os dados.

Responda APENAS com JSON válido, sem markdown, no formato:
{"profissionais": [{"nome": "", "categoria": "", "regiao": "", "contato_publico": "", "fonte_url": "", "motivo": ""}]}

Regras:
- Só inclua páginas que realmente pareçam ser do profissional/negócio, não notícia/blog/irrelevante.
- "motivo" é uma frase curta de por que atende ao pedido do cliente.
- "contato_publico" só se o texto trouxer e-mail/telefone explícito. Não invente.
- Não invente nenhum dado que não esteja no texto fornecido.`;

  const resposta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: MODELO_GROQ,
      temperature: 0,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Pedido do cliente: "${q}"\n\nPáginas encontradas: ${JSON.stringify(
            achados.map((a) => ({ titulo: a.title, url: a.url, resumo: (a.content || "").slice(0, 500) }))
          )}`,
        },
      ],
    }),
  });

  if (!resposta.ok) throw new Error(`Groq respondeu ${resposta.status}`);
  const corpo = await resposta.json();
  const conteudo = corpo.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(conteudo);
  return parsed.profissionais || [];
}

async function lerCache() {
  try {
    const filePath = path.join(process.cwd(), "resultados.json");
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    return [];
  }
}

async function salvarCache(dados) {
  try {
    const filePath = path.join(process.cwd(), "resultados.json");
    await writeFile(filePath, JSON.stringify(dados, null, 2));
  } catch {
    // Em serverless, o disco é temporário — a escrita pode não persistir
    // entre execuções. Isso é esperado; o cache "de verdade" é só um bônus
    // dentro da mesma execução/instância. Não trava a resposta ao usuário.
  }
}

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (!q) {
    return res.status(200).json({ resultados: [], modo: "sem_busca" });
  }

  const cacheAtual = await lerCache();
  const termos = normalizar(q).split(/\s+/).filter(Boolean);
  const doCache = cacheAtual.filter((item) =>
    termos.some((t) => normalizar(item.categoria).includes(t) || normalizar(item.nome).includes(t))
  );

  if (doCache.length > 0) {
    return res.status(200).json({ resultados: doCache, modo: "cache" });
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!tavilyKey || !groqKey) {
    return res.status(200).json({
      resultados: [],
      modo: "sem_chave",
      aviso: "TAVILY_API_KEY e/ou GROQ_API_KEY não configuradas no Vercel.",
    });
  }

  try {
    const achados = await buscarNaWeb(q, tavilyKey);
    if (achados.length === 0) {
      return res.status(200).json({ resultados: [], modo: "busca_vazia" });
    }

    const profissionais = await estruturarComGroq(q, achados, groqKey);

    const novos = profissionais.map((p) => ({ ...p, coletado_em: new Date().toISOString() }));
    const combinados = [...cacheAtual, ...novos].filter(
      (item, i, arr) => arr.findIndex((x) => x.fonte_url === item.fonte_url) === i
    );
    await salvarCache(combinados);

    return res.status(200).json({ resultados: novos, modo: "busca_ao_vivo" });
  } catch (erro) {
    return res.status(200).json({ resultados: [], modo: "erro", aviso: erro.message });
  }
}

