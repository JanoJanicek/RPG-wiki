const http = require('http');
const fs = require('fs').promises;
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'JanoJanicekA3J';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'session_token_meplay_secure_2026';

const ARTICLES_FILE = path.join(__dirname, 'articles.json');
const CATEGORIES_FILE = path.join(__dirname, 'categories.json');

const defaultCategories = [
  { id: 'start', name: 'Základy & Připojení', icon: 'fa-gamepad' },
  { id: 'mechanics', name: 'Herní mechaniky', icon: 'fa-sword' },
  { id: 'world', name: 'Svět & Lokace', icon: 'fa-compass' },
  { id: 'lore', name: 'Lore & Postavy', icon: 'fa-book-open' }
];

const defaultArticles = [{
  id: 'w-01', category: 'start', categoryName: 'Základy & Připojení',
  title: 'Jak se připojit na herní server',
  excerpt: 'Návod na konfiguraci klienta Minecraft, stažení resource packu a první připojení.',
  readTime: 3,
  image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
  tip: 'V nastavení serveru měj povolené Server Resource Packs: Prompt nebo Enabled.',
  keywords: ['ip', 'připojení', 'pripojeni', 'verze', 'mc.meplay.cz', 'resourcepack', '1.21.11'],
  content: '<p class="font-bold text-white text-lg">Vítej v průvodci MePlay RPG.</p><p>Pro nejlepší stabilitu doporučujeme <strong>Minecraft Java Edition 1.21.11</strong>. Pro připojení použij IP adresu <strong class="text-rpgGold">mc.meplay.cz</strong>.</p>'
}];

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

async function readData(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { await writeData(file, fallback); return fallback; }
}

function writeData(file, data) { return fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8'); }
function sendJSON(res, status, data) { 
  if (res.headersSent) return;
  res.writeHead(status, jsonHeaders); 
  res.end(JSON.stringify(data)); 
}
function sendError(res, status, error) { sendJSON(res, status, { success: false, error }); }

function authed(req) { return (req.headers.authorization || '') === `Bearer ${ADMIN_TOKEN}`; }

function requireAdmin(req, res) { 
  if (authed(req)) return true; 
  sendError(res, 401, 'Nejprve se přihlas do administrace.'); 
  return false; 
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) reject(new Error('Payload too large')); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function articleCategory(article) { return typeof article.category === 'object' ? article.category.id : article.category; }

function normalizeArticle(article, categories) {
  const categoryId = articleCategory(article);
  const category = categories.find(c => c.id === categoryId) || categories[0] || { id: 'start', name: 'Základy', icon: 'fa-folder' };
  return { ...article, category: category.id, categoryName: category.name, readTime: Math.max(1, parseInt(article.readTime, 10) || 3), keywords: Array.isArray(article.keywords) ? article.keywords.filter(Boolean) : [] };
}

async function formatArticles(items) {
  const categories = await readData(CATEGORIES_FILE, defaultCategories);
  return items.map(item => {
    const article = normalizeArticle(item, categories);
    const category = categories.find(c => c.id === article.category) || { id: article.category, name: article.categoryName, icon: 'fa-folder' };
    return { ...article, category, categoryId: category.id, categoryName: category.name };
  });
}

async function serveFile(res, fileName, type) {
  if (res.headersSent) return;
  const root = path.resolve(__dirname);
  const target = path.resolve(__dirname, fileName.replace(/^\/+/, ''));
  
  if (!target.startsWith(root)) {
    return sendError(res, 403, 'Přístup k souboru není povolen.');
  }
  
  try { 
    const data = await fs.readFile(target);
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': type }); 
      res.end(data);
    }
  } catch { 
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); 
      res.end('Soubor nebyl nalezen.');
    }
  }
}

async function handleCategories(req, res, method, url) {
  const categories = await readData(CATEGORIES_FILE, defaultCategories);
  
  if (method === 'GET' && url === '/api/categories') {
    sendJSON(res, 200, categories);
    return true;
  }
  
  if (!requireAdmin(req, res)) return true;
  
  if (method === 'POST' && url === '/api/categories') {
    const body = await readBody(req), id = slug(body.id || body.name);
    if (!id || !body.name) return sendError(res, 400, 'Kategorie musí mít název a platné ID.'), true;
    if (categories.some(c => c.id === id)) return sendError(res, 409, 'Kategorie s tímto ID už existuje.'), true;
    const category = { id, name: String(body.name).trim(), icon: String(body.icon || 'fa-folder').trim() };
    categories.push(category); await writeData(CATEGORIES_FILE, categories); 
    sendJSON(res, 201, category);
    return true;
  }
  
  if (method === 'PUT' && url.startsWith('/api/categories/')) {
    const id = decodeURIComponent(url.split('/').pop()), i = categories.findIndex(c => c.id === id);
    if (i < 0) return sendError(res, 404, 'Kategorie nenalezena.'), true;
    const body = await readBody(req);
    categories[i] = { ...categories[i], name: String(body.name || categories[i].name).trim(), icon: String(body.icon || categories[i].icon || 'fa-folder').trim() };
    await writeData(CATEGORIES_FILE, categories); 
    sendJSON(res, 200, categories[i]);
    return true;
  }
  
  if (method === 'DELETE' && url.startsWith('/api/categories/')) {
    const id = decodeURIComponent(url.split('/').pop());
    const articles = await readData(ARTICLES_FILE, defaultArticles);
    if (articles.some(a => articleCategory(a) === id)) return sendError(res, 409, 'Kategorie obsahuje články. Nejdřív je přesuň nebo smaž.'), true;
    await writeData(CATEGORIES_FILE, categories.filter(c => c.id !== id)); 
    sendJSON(res, 200, { success: true });
    return true;
  }
  
  return false;
}

async function handleArticles(req, res, method, url) {
  const categories = await readData(CATEGORIES_FILE, defaultCategories);
  
  if (method === 'GET' && url === '/api/articles') {
    sendJSON(res, 200, await formatArticles(await readData(ARTICLES_FILE, defaultArticles)));
    return true;
  }
  
  if (!requireAdmin(req, res)) return true;
  
  if (method === 'POST' && url === '/api/articles') {
    const articles = await readData(ARTICLES_FILE, defaultArticles);
    const article = normalizeArticle({ ...(await readBody(req)), id: `w-${Date.now()}` }, categories);
    articles.push(article); await writeData(ARTICLES_FILE, articles); 
    sendJSON(res, 201, (await formatArticles([article]))[0]);
    return true;
  }
  
  if (method === 'PUT' && url.startsWith('/api/articles/')) {
    const id = decodeURIComponent(url.split('/').pop()), body = await readBody(req), articles = await readData(ARTICLES_FILE, defaultArticles), i = articles.findIndex(a => a.id === id);
    if (i < 0) return sendError(res, 404, 'Článek nenalezen.'), true;
    articles[i] = normalizeArticle({ ...articles[i], ...body, id }, categories); await writeData(ARTICLES_FILE, articles); 
    sendJSON(res, 200, (await formatArticles([articles[i]]))[0]);
    return true;
  }
  
  if (method === 'DELETE' && url.startsWith('/api/articles/')) {
    const id = decodeURIComponent(url.split('/').pop()), articles = await readData(ARTICLES_FILE, defaultArticles);
    await writeData(ARTICLES_FILE, articles.filter(a => a.id !== id)); 
    sendJSON(res, 200, { success: true });
    return true;
  }
  
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`).pathname, method = req.method;
    
    if (method === 'OPTIONS') { 
      res.writeHead(204, jsonHeaders); 
      return res.end(); 
    }
    
    if (method === 'GET' && (url === '/' || url === '/index.html' || url === '/wiki')) {
      await serveFile(res, 'index.html', 'text/html; charset=utf-8');
      return; // <--- STRKTNÍ UKONČENÍ
    }
    
    if (method === 'POST' && url === '/api/login') {
      const body = await readBody(req);
      if (body.password === ADMIN_PASSWORD) {
        sendJSON(res, 200, { success: true, token: ADMIN_TOKEN });
      } else {
        sendError(res, 401, 'Neplatný šifrovací klíč.');
      }
      return;
    }
    
    if (url === '/api/categories' || url.startsWith('/api/categories/')) { 
      if (await handleCategories(req, res, method, url) === true) return; 
    }
    
    if (url === '/api/articles' || url.startsWith('/api/articles/')) { 
      if (await handleArticles(req, res, method, url) === true) return; 
    }
    
    if (method === 'GET') {
      const ext = path.extname(url).toLowerCase();
      // Pokud se snažíš načíst routu bez přípony (např. /wiki/nejaky-clanek), vrátíme index.html (SPA routing)
      if (!ext) {
        await serveFile(res, 'index.html', 'text/html; charset=utf-8');
        return;
      }
      
      const mime = { 
        '.css': 'text/css; charset=utf-8', 
        '.js': 'application/javascript; charset=utf-8', 
        '.png': 'image/png', 
        '.jpg': 'image/jpeg', 
        '.jpeg': 'image/jpeg', 
        '.webp': 'image/webp', 
        '.svg': 'image/svg+xml; charset=utf-8' 
      }[ext] || 'text/plain; charset=utf-8';
      
      await serveFile(res, url.substring(1), mime);
      return;
    }
    
    sendError(res, 404, 'Nenalezeno.');
  } catch (e) { 
    console.error("Kritická chyba routeru:", e); 
    if (!res.headersSent) {
      sendError(res, 500, 'Server narazil na chybu při zpracování požadavku.'); 
    }
  }
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(' MePlay RPG Wiki backend uspesne spusten');
  console.log(` Webova aplikace: http://localhost:${PORT}`);
  console.log(` Wiki:             http://localhost:${PORT}/wiki`);
  console.log('====================================================');
});