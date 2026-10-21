const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

// Exercise the real files and MIME types, not an HTML response for every URL.
function createStaticServer(basePath = '/') {
  return http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(basePath)) throw new Error('Outside the test mount');
      const relative = pathname.slice(basePath.length) || 'lingodeck.html';
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(root + path.sep) ||
          !(relative === 'lingodeck.html' || relative.startsWith('assets/')) ||
          !fs.statSync(filename).isFile()) throw new Error('Not an application file');
      response.setHeader('Content-Type', contentTypes[path.extname(filename)] || 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(filename).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  });
}

module.exports = { createStaticServer };
