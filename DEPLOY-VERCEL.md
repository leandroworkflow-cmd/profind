# Deploy do ProFind no Vercel

## Antes de tudo — não confunda as duas pastas

Você tem dois projetos separados no seu computador:

- `~/profind` — o **site** (HTML + a função de busca). É esse que vai pro Vercel.
- `~/profind-crawler` — o **robô** de coleta. Roda só localmente, nunca vai pro Vercel nem pro GitHub.

Os dois têm um arquivo `package.json`, mas **são diferentes** (um tem `cheerio`
e `robots-parser`, o outro só declara `"type": "module"`). Foi exatamente
uma mistura desses dois tipos de arquivo que causou aquele erro de
`recharts`/`Missing script: start` lá atrás. Mantenha as pastas bem separadas.

## Arquivos novos que entram na pasta `~/profind`

```
profind/
├── index.html
├── resultados.html
├── resultados.json      ← dados que o robô gera (começa vazio: [])
├── package.json          ← NOVO — declara o projeto como módulo ES
├── .env.example           ← NOVO — só de referência, não sobe segredo real
└── api/
    └── buscar.js          ← NOVO — a função de busca com IA
```

## Passo a passo

### 1. Coloca os arquivos novos na pasta certa

No terminal do Linux:
```bash
cd ~/profind
mkdir -p api
cp ~/Downloads/api/buscar.js api/     # ou copia manualmente pelo Finder/Nautilus
cp ~/Downloads/package.json .
cp ~/Downloads/.env.example .
```

### 2. Sobe pro GitHub, igual sempre

```bash
git add -A
git commit -m "adiciona backend de busca com IA para deploy no Vercel"
git push
```

### 3. Cria conta no Vercel e conecta o repositório

1. Vai em [vercel.com](https://vercel.com) → cria conta gratuita (dá pra entrar direto com sua conta do GitHub)
2. "Add New" → "Project"
3. Escolhe o repositório `profind`
4. Nas opções de configuração, **não precisa mexer em nada** — sem framework, sem build command. Deixa em branco/padrão.

### 4. Configura a chave da Groq (o passo mais importante)

Antes de clicar em "Deploy", ou depois em Settings → Environment Variables:
- Nome: `GROQ_API_KEY`
- Valor: sua chave da Groq (a nova, não a que você já revogou)
- Ambiente: marca todos (Production, Preview, Development)

### 5. Deploy

Clica em "Deploy". Em cerca de 1 minuto, o Vercel te dá uma URL tipo
`profind.vercel.app`.

### 6. Testa

Abre `https://profind-seu-usuario.vercel.app/resultados.html?q=pintor`.
Se `resultados.json` já tiver dado real (rodou o robô e atualizou o arquivo),
a busca deve responder usando a IA — não é mais o modo estático.

## Uma observação sobre uso comercial

O plano gratuito (Hobby) do Vercel é rotulado para **uso pessoal/não
comercial**. Pra um protótipo e primeiros testes, tudo bem. Mas se o ProFind
começar a cobrar de profissionais ou rodar anúncio, o certo — inclusive
pra não violar os termos de uso — é migrar pro plano Pro (pago) nesse
momento. É o mesmo gatilho "quando virar escala, aí paga" que a gente já
vinha combinando, só que agora vale também pra hospedagem, não só pra IA.
