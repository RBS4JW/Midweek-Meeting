// Tiny static file server for local preview of the /public app.
// Usage: node server.js   ->   http://localhost:8788
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, 'public');
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8788, () => console.log('Midweek app preview on http://localhost:8788'));
