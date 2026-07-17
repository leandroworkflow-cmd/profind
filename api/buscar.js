// api/buscar.js
// Função serverless do Vercel. Recebe a busca do usuário (?q=...), lê os
// profissionais já coletados (resultados.json, na raiz do projeto) e usa a
// Groq pra interpretar o pedido e devolver os mais relevantes, com o motivo
// da recomendação.
//
// Se não houver GROQ_API_KEY configurada (ou a chamada falhar), cai num
// filtro simples por palavra-chave — nunca quebra a busca do usuário.

import { readFile } from "node:fs/promises";
import path from "node:path";

const MODELO = "llama-3.3-70b-versatile";

function normalizar(txt) {
  return (txt || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function contemTermo(campo, termo) {
  const campoNorm = normalizar(campo);
  if (campoNorm.includes(termo)) return true;
  // tolera variação de gênero/plural (ex: "advogado" deve achar "advogada")
  if (termo.length >= 5 && campoNorm.includes(termo.slice(0, -1))) return true;
  return false;
}

function filtrarSimples(dados, q) {
  const termos = normalizar(q).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return dados;

  return dados
    .map((item) => {
      let score = 0;
      const campos = [
        { valor: item.categoria, peso: 3 },
        { valor: item.nome, peso: 2 },
        { valor: item.regiao, peso: 2 },
      ];
      for (const termo of termos) {
        for (const c of campos) {
          if (contemTermo(c.valor, termo)) score += c.peso;
        }
      }
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function ranquearComIA(dados, q, apiKey) {
  const prompt = `Você recebe um pedido de um cliente e uma lista de profissionais/negócios
já coletados. Escolha quais realmente atendem ao pedido e ordene do mais pro
menos relevante. Para cada um, escreva um motivo curto (uma frase) explicando
por que ele atende ao pedido.

Responda APENAS com JSON válido, sem markdown, no formato:
{"indices_relevantes": [{"indice": 0, "motivo": "..."}, ...]}

Use o "indice" exatamente como aparece na lista fornecida (posição, começando em 0).
Se nenhum profissional da lista atender ao pedido, responda {"indices_relevantes": []}.
Não invente profissionais que não estão na lista.`;

  const listaParaIA = dados.map((d, i) => ({
    indice: i,
    nome: d.nome,
    categoria: d.categoria,
    regiao: d.regiao,
  }));

  const resposta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Pedido do cliente: "${q}"\n\nLista: ${JSON.stringify(listaParaIA)}` },
      ],
    }),
  });

  if (!resposta.ok) throw new Error(`Groq respondeu ${resposta.status}`);

  const corpo = await resposta.json();
  const conteudo = corpo.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(conteudo);

  return (parsed.indices_relevantes || [])
    .filter((r) => dados[r.indice])
    .map((r) => ({ ...dados[r.indice], motivo: r.motivo }));
}

export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();

  let dados = [];
  try {
    const filePath = path.join(process.cwd(), "resultados.json");
    dados = JSON.parse(await readFile(filePath, "utf-8"));
  } catch {
    dados = [];
  }

  if (dados.length === 0) {
    return res.status(200).json({ resultados: [], modo: "vazio" });
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || !q) {
    return res.status(200).json({ resultados: filtrarSimples(dados, q), modo: "simples" });
  }

  try {
    const ranqueados = await ranquearComIA(dados, q, apiKey);
    return res.status(200).json({ resultados: ranqueados, modo: "ia" });
  } catch (erro) {
    return res.status(200).json({
      resultados: filtrarSimples(dados, q),
      modo: "simples",
      aviso: "IA indisponível no momento, usando busca por palavra-chave.",
    });
  }
}
