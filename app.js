const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const unzipper = require('unzipper');
const axios = require('axios');
const { marked } = require('marked');
const hljs = require('highlight.js');

// Global markdown extensions
const markdownExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn']);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Homepage: Improved UI with lagom aesthetic
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Repo Flattener</title>
      <style>
        body {
          background: #0d1117;
          color: #c9d1d9;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          overflow: hidden;
        }
        .container {
          max-width: 600px;
          text-align: center;
          padding: 2rem;
          z-index: 1;
        }
        h1 {
          font-size: 2.5rem;
          margin-bottom: 1.5rem;
          color: #e6edf3;
          text-shadow: 0 0 10px rgba(255,255,255,0.2);
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        input {
          padding: 0.75rem;
          font-size: 1rem;
          background: #161b22;
          color: #c9d1d9;
          border: 1px solid #30363d;
          border-radius: 8px;
          transition: all 0.3s ease;
          outline: none;
        }
        input:focus {
          border-color: #79b8ff;
          box-shadow: 0 0 8px rgba(88,166,255,0.5);
        }
        button {
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          background: linear-gradient(45deg, #1f6feb, #79b8ff);
          color: #fff;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(88,166,255,0.4);
        }
        /* Starry background */
        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; width: 100%; height: 100%;
          background: radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: stars 60s linear infinite;
          z-index: -1;
          opacity: 0.7;
        }
        @keyframes stars {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Flatten GitHub Repo</h1>
        <form action="/flatten" method="post">
          <input type="text" name="repo_url" placeholder="Enter GitHub Repo URL (e.g., https://github.com/owner/repo)" required>
          <button type="submit">Flatten Repo</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Endpoint to flatten repo
app.post('/flatten', async (req, res) => {
  const repoUrl = req.body.repo_url;
  if (!repoUrl || !repoUrl.startsWith('https://github.com/')) {
    return res.status(400).send('Invalid GitHub repo URL.');
  }

  try {
    // Derive owner/repo from URL
    const parts = repoUrl.replace('.git', '').split('/').slice(-2);
    const owner = parts[0];
    const repo = parts[1];
    const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;

    // Create temp dir
    const tempDir = path.join(os.tmpdir(), crypto.randomUUID());
    fs.mkdirSync(tempDir, { recursive: true });

    // Download ZIP
    const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });
    const zipBuffer = response.data;

    // Extract ZIP
    await new Promise((resolve, reject) => {
      fs.createWriteStream(path.join(tempDir, 'repo.zip'))
        .on('finish', () => {
          fs.createReadStream(path.join(tempDir, 'repo.zip'))
            .pipe(unzipper.Extract({ path: tempDir }))
            .on('close', resolve)
            .on('error', reject);
        })
        .on('error', reject)
        .end(zipBuffer);
    });

    // Find extracted directory
    const extracted = fs.readdirSync(tempDir).find(f => fs.statSync(path.join(tempDir, f)).isDirectory());
    if (!extracted) throw new Error('No extracted directory found.');
    const repoDir = path.join(tempDir, extracted);

    // Collect files
    const infos = collectFiles(repoDir);

    // Generate HTML
    const html = buildHtml(repoUrl, repoDir, infos);

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });

    res.send(html);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error processing repo: ' + error.message);
  }
});

function collectFiles(repoRoot) {
  const infos = [];
  const maxBytes = 50 * 1024;
  const binaryExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
    '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.ogg', '.flac',
    '.ttf', '.otf', '.eot', '.woff', '.woff2',
    '.so', '.dll', '.dylib', '.class', '.jar', '.exe', '.bin',
  ]);

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir, { withFileTypes: true });
    files.forEach(file => {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        if (!fullPath.includes('/.git/')) walk(fullPath);
      } else if (file.isFile()) {
        const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        if (rel.includes('/.git/') || rel.startsWith('.git/')) return;
        const stats = fs.statSync(fullPath);
        const size = stats.size;
        if (size > maxBytes) {
          infos.push({ rel, size, decision: { include: false, reason: 'too_large' } });
          return;
        }
        const ext = path.extname(rel).toLowerCase();
        if (binaryExtensions.has(ext) || isBinary(fullPath)) {
          infos.push({ rel, size, decision: { include: false, reason: 'binary' } });
          return;
        }
        infos.push({ rel, size, decision: { include: true, reason: 'ok' }, ext, path: fullPath });
      }
    });
  }

  walk(repoRoot);
  return infos.sort((a, b) => a.rel.localeCompare(b.rel));
}

function isBinary(filePath) {
  try {
    const buffer = fs.readFileSync(filePath, { encoding: null });
    return buffer.includes(0);
  } catch {
    return true;
  }
}

function bytesHuman(n) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let f = n;
  let i = 0;
  while (f >= 1024 && i < units.length - 1) {
    f /= 1024;
    i++;
  }
  return i === 0 ? `${Math.floor(f)} ${units[i]}` : `${f.toFixed(1)} ${units[i]}`;
}

function generateTreeFallback(root) {
  let lines = [path.basename(root)];
  function walk(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== '.git');
    entries.sort((a, b) => (a.isDirectory() ? 0 : 1) - (b.isDirectory() ? 0 : 1) || a.name.localeCompare(b.name));
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const branch = last ? '└── ' : '├── ';
      lines.push(prefix + branch + e.name);
      if (e.isDirectory()) {
        const extension = last ? '    ' : '│   ';
        walk(path.join(dir, e.name), prefix + extension);
      }
    });
  }
  walk(root);
  return lines.join('\n');
}

function slugify(str) {
  return str.replace(/[^a-zA-Z0-9-_]/g, '-');
}

function buildHtml(repoUrl, repoDir, infos) {
  const rendered = infos.filter(i => i.decision.include);
  const skippedBinary = infos.filter(i => i.decision.reason === 'binary');
  const skippedLarge = infos.filter(i => i.decision.reason === 'too_large');
  const skippedIgnored = infos.filter(i => i.decision.reason === 'ignored');
  const totalFiles = rendered.length + skippedBinary.length + skippedLarge.length + skippedIgnored.length;

  const treeText = generateTreeFallback(repoDir);

  // TOC
  let tocHtml = '';
  rendered.forEach(i => {
    const anchor = slugify(i.rel);
    tocHtml += `<li><a href="#file-${anchor}">${escapeHtml(i.rel)}</a> <span class="muted">(${bytesHuman(i.size)})</span></li>`;
  });

  // Sections
  let sections = '';
  rendered.forEach(i => {
    const anchor = slugify(i.rel);
    let bodyHtml = '';
    try {
      const text = fs.readFileSync(i.path, 'utf-8');
      if (i.ext && markdownExtensions.has(i.ext.toLowerCase())) {
        bodyHtml = marked.parse(text);
      } else {
        const highlighted = hljs.highlightAuto(text).value;
        bodyHtml = `<pre><code class="hljs">${highlighted}</code></pre>`;
      }
    } catch (e) {
      bodyHtml = `<pre class="error">Failed to render: ${escapeHtml(e.message)}</pre>`;
    }
    sections += `
      <section class="file-section" id="file-${anchor}">
        <h2>${escapeHtml(i.rel)} <span class="muted">(${bytesHuman(i.size)})</span></h2>
        <div class="file-body">${bodyHtml}</div>
        <div class="back-top"><a href="#top">↑ Back to top</a></div>
      </section>
    `;
  });

  // Skipped
  function renderSkipList(title, items) {
    if (!items.length) return '';
    let lis = items.map(i => `<li><code>${escapeHtml(i.rel)}</code> <span class='muted'>(${bytesHtml(i.size)})</span></li>`).join('\n');
    return `<details open><summary>${escapeHtml(title)} (${items.length})</summary><ul class='skip-list'>${lis}</ul></details>`;
  }
  const skippedHtml = renderSkipList('Skipped binaries', skippedBinary) + renderSkipList('Skipped large files', skippedLarge);

  // HTML with animated toggle
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Flattened repo – ${escapeHtml(repoUrl)}</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0; padding: 0; line-height: 1.45; background: #0d1117; color: #c9d1d9;
        }
        .container { max-width: 1100px; margin: 0 auto; padding: 0 1rem; }
        .meta small { color: #8b949e; }
        .counts { margin-top: 0.25rem; color: #c9d1d9; }
        .muted { color: #8b949e; font-weight: normal; font-size: 0.9em; }
        .page { display: grid; grid-template-columns: 320px minmax(0,1fr); gap: 0; }
        #sidebar {
          position: sticky; top: 0; align-self: start;
          height: 100vh; overflow: auto;
          border-right: 1px solid #30363d; background: #0d1117;
        }
        #sidebar .sidebar-inner { padding: 0.75rem; }
        #sidebar h2 { margin: 0 0 0.5rem 0; font-size: 1rem; color: #c9d1d9; }
        .toc { list-style: none; padding-left: 0; margin: 0; }
        .toc li { padding: 0.15rem 0; white-space: nowrap; }
        .toc a { text-decoration: none; color: #79b8ff; font-weight: 500; }
        .toc a:hover { text-decoration: underline; }
        main.container { padding-top: 1rem; }
        pre { background: #161b22; padding: 0.75rem; overflow: auto; border-radius: 6px; }
        code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
        .file-section { padding: 1rem; border-top: 1px solid #30363d; }
        .file-section h2 { margin: 0 0 0.5rem 0; font-size: 1.1rem; color: #c9d1d9; }
        .file-body { margin-bottom: 0.5rem; }
        .back-top { font-size: 0.9rem; }
        .back-top a { color: #79b8ff; font-weight: 500; }
        .skip-list code { background: #161b22; padding: 0.1rem 0.3rem; border-radius: 4px; }
        .error { color: #ff7b72; background: #2e0b0b; font-weight: 500; }
        .toc-top { display: block; }
        @media (min-width: 1000px) { .toc-top { display: none; } }
        :target { scroll-margin-top: 8px; }
        
        /* Starry background */
        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; width: 100%; height: 100%;
          background: radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px);
          background-size: 40px 40px;
          animation: stars 60s linear infinite;
          z-index: -1;
          opacity: 0.7;
        }
        @keyframes stars {
          0% { background-position: 0 0; }
          100% { background-position: 40px 40px; }
        }
        
        /* Animated toggle icons */
        .view-toggle {
          margin: 1rem 0;
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }
        .toggle-btn {
          padding: 0.6rem;
          background: rgba(22, 27, 34, 0.8);
          border: 1px solid #30363d;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
        }
        
        .toggle-btn.active {
          border-color: #79b8ff;
          background: rgba(121, 184, 255, 0.1);
          box-shadow: 0 0 20px rgba(121, 184, 255, 0.3);
          transform: scale(1.1);
        }
        
        .toggle-btn:not(.active) {
          opacity: 0.7;
        }
        
        .toggle-btn:hover:not(.active) {
          transform: scale(1.05);
          opacity: 0.9;
          border-color: #484f58;
        }
        
        /* Human icon - organic flowing curves */
        .human-icon {
          width: 24px;
          height: 24px;
          position: relative;
        }
        
        .human-curve {
          position: absolute;
          border: 2px solid #c9d1d9;
          border-radius: 50%;
          opacity: 0.8;
        }
        
        .human-curve:nth-child(1) {
          width: 16px;
          height: 16px;
          top: 2px;
          left: 4px;
          animation: humanFlow1 4s ease-in-out infinite;
        }
        
        .human-curve:nth-child(2) {
          width: 12px;
          height: 20px;
          top: 0px;
          left: 6px;
          border-radius: 60% 40% 40% 60%;
          animation: humanFlow2 4s ease-in-out infinite -1s;
        }
        
        .human-curve:nth-child(3) {
          width: 20px;
          height: 8px;
          top: 8px;
          left: 2px;
          border-radius: 50% 50% 80% 80%;
          animation: humanFlow3 4s ease-in-out infinite -2s;
        }
        
        @keyframes humanFlow1 {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
            border-radius: 50%;
          }
          50% { 
            transform: scale(1.1) rotate(5deg);
            border-radius: 60% 40% 40% 60%;
          }
        }
        
        @keyframes humanFlow2 {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
            border-radius: 60% 40% 40% 60%;
          }
          50% { 
            transform: scale(0.9) rotate(-3deg);
            border-radius: 40% 60% 60% 40%;
          }
        }
        
        @keyframes humanFlow3 {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
            border-radius: 50% 50% 80% 80%;
          }
          50% { 
            transform: scale(1.05) rotate(2deg);
            border-radius: 80% 80% 50% 50%;
          }
        }
        
        /* LLM icon - matrix grid with cascading highlights */
        .llm-icon {
          width: 24px;
          height: 24px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 2px;
          position: relative;
        }
        
        .llm-dot {
          width: 4px;
          height: 4px;
          background: #c9d1d9;
          border-radius: 1px;
          opacity: 0.4;
          transition: all 0.3s ease;
        }
        
        .llm-highlight {
          position: absolute;
          width: 6px;
          height: 6px;
          background: #79b8ff;
          border-radius: 2px;
          opacity: 0;
          box-shadow: 0 0 8px #79b8ff;
          animation: matrixCascade 3s linear infinite;
        }
        
        .llm-highlight:nth-child(17) { animation-delay: 0s; }
        .llm-highlight:nth-child(18) { animation-delay: 0.2s; }
        .llm-highlight:nth-child(19) { animation-delay: 0.4s; }
        .llm-highlight:nth-child(20) { animation-delay: 0.6s; }
        .llm-highlight:nth-child(21) { animation-delay: 0.8s; }
        .llm-highlight:nth-child(22) { animation-delay: 1s; }
        
        @keyframes matrixCascade {
          0% { 
            opacity: 0;
            transform: translateY(-4px) scale(0.8);
          }
          20% { 
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          80% { 
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          100% { 
            opacity: 0;
            transform: translateY(20px) scale(0.8);
          }
        }
        
        /* Active state enhancements */
        .toggle-btn.active .human-curve {
          border-color: #79b8ff;
          box-shadow: 0 0 4px rgba(121, 184, 255, 0.4);
        }
        
        .toggle-btn.active .llm-dot {
          opacity: 0.6;
        }
        
        .toggle-btn.active .llm-highlight {
          background: #ffffff;
          box-shadow: 0 0 12px #79b8ff;
        }
        
        #llm-view { display: none; }
        #llm-text {
          width: 100%;
          height: 70vh;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.85em;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 1rem;
          resize: vertical;
          background: #161b22;
          color: #c9d1d9;
        }
        .copy-hint {
          margin-top: 0.5rem;
          color: #8b949e;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <a id="top"></a>
      <div class="page">
        <nav id="sidebar"><div class="sidebar-inner">
          <h2>Contents (${rendered.length})</h2>
          <ul class="toc toc-sidebar">
            <li><a href="#top">↑ Back to top</a></li>
            ${tocHtml}
          </ul>
        </div></nav>
        <main class="container">
          <section>
            <div class="meta">
              <div><strong>Repository:</strong> <a href="${escapeHtml(repoUrl)}">${escapeHtml(repoUrl)}</a></div>
              <div class="counts">
                <strong>Total files:</strong> ${totalFiles} · <strong>Rendered:</strong> ${rendered.length} · <strong>Skipped:</strong> ${totalFiles - rendered.length}
              </div>
            </div>
          </section>
          <div class="view-toggle">
            <strong>View:</strong>
            <button class="toggle-btn active" onclick="showHumanView()" title="Human View">
              <div class="human-icon">
                <div class="human-curve"></div>
                <div class="human-curve"></div>
                <div class="human-curve"></div>
              </div>
            </button>
            <button class="toggle-btn" onclick="showLLMView()" title="LLM View">
              <div class="llm-icon">
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-dot"></div>
                <div class="llm-highlight" style="top: 0px; left: 0px;"></div>
                <div class="llm-highlight" style="top: 6px; left: 6px;"></div>
                <div class="llm-highlight" style="top: 12px; left: 12px;"></div>
                <div class="llm-highlight" style="top: 18px; left: 18px;"></div>
                <div class="llm-highlight" style="top: 0px; left: 18px;"></div>
                <div class="llm-highlight" style="top: 18px; left: 0px;"></div>
              </div>
            </button>
          </div>
          <div id="human-view">
            <section>
              <h2>Directory tree</h2>
              <pre>${escapeHtml(treeText)}</pre>
            </section>
            <section class="toc-top">
              <h2>Table of contents (${rendered.length})</h2>
              <ul class="toc">${tocHtml}</ul>
            </section>
            <section>
              <h2>Skipped items</h2>
              ${skippedHtml}
            </section>
            ${sections}
          </div>
          <div id="llm-view">
            <section>
              <h2>🤖 LLM View - CXML Format</h2>
              <p>Copy the text below and paste it to an LLM for analysis:</p>
              <textarea id="llm-text" readonly>${escapeHtml(generateCxmlText(infos, repoDir))}</textarea>
              <div class="copy-hint">
                💡 <strong>Tip:</strong> Click in the text area and press Ctrl+A (Cmd+A on Mac) to select all, then Ctrl+C (Cmd+C) to copy.
              </div>
            </section>
          </div>
        </main>
      </div>
      <script>
        function showHumanView() {
          document.getElementById('human-view').style.display = 'block';
          document.getElementById('llm-view').style.display = 'none';
          document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
          event.target.closest('.toggle-btn').classList.add('active');
        }
        function showLLMView() {
          document.getElementById('human-view').style.display = 'none';
          document.getElementById('llm-view').style.display = 'block';
          document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
          event.target.closest('.toggle-btn').classList.add('active');
          setTimeout(() => {
            const textArea = document.getElementById('llm-text');
            textArea.focus();
            textArea.select();
          }, 100);
        }
      </script>
    </body>
    </html>
  `;
}

function generateCxmlText(infos, repoDir) {
  let lines = ["<documents>"];
  const rendered = infos.filter(i => i.decision.include);
  rendered.forEach((i, index) => {
    lines.push(`<document index="${index + 1}">`);
    lines.push(`<source>${i.rel}</source>`);
    lines.push("<document_content>");
    try {
      const text = fs.readFileSync(i.path, 'utf-8');
      lines.push(text);
    } catch (e) {
      lines.push(`Failed to read: ${e.message}`);
    }
    lines.push("</document_content>");
    lines.push("</document>");
  });
  lines.push("</documents>");
  return lines.join("\n");
}

function escapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

app.listen(port, () => {
  console.log(`App running on http://localhost:${port}`);
});