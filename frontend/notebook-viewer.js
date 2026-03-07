/**
 * NotebookViewer - Read-only Jupyter notebook renderer.
 *
 * Dependencies (loaded as globals before this script):
 *   - marked.min.js          (global: marked)
 *   - highlight.min.js       (global: hljs)
 *   - highlight-python.min.js
 *   - katex.min.js           (global: katex)         [optional]
 *   - katex-auto-render.min.js (global: renderMathInElement) [optional]
 *
 * Usage:
 *   NotebookViewer.render('#container', '/path/to/notebook.ipynb');
 *   NotebookViewer.render('#container', '/path/to/notebook.ipynb', { showCellNumbers: true });
 */
(function (root) {
    'use strict';

    // ── Helpers ──────────────────────────────────────────────────────────

    function textValue(v) {
        if (Array.isArray(v)) return v.join('');
        return v || '';
    }

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── ANSI → HTML ─────────────────────────────────────────────────────

    const ANSI_COLORS = [
        '#000000','#cd0000','#00cd00','#cdcd00','#0000ee','#cd00cd','#00cdcd','#e5e5e5',
        '#7f7f7f','#ff0000','#00ff00','#ffff00','#5c5cff','#ff00ff','#00ffff','#ffffff',
    ];

    function ansi256Color(n) {
        if (n < 16) return ANSI_COLORS[n];
        if (n >= 232) { const g = 8 + (n - 232) * 10; return `rgb(${g},${g},${g})`; }
        n -= 16;
        return `rgb(${Math.floor(n/36)*51},${Math.floor((n%36)/6)*51},${(n%6)*51})`;
    }

    function ansiToHtml(text) {
        let html = '', i = 0;
        let bold = false, dim = false, italic = false, underline = false, strike = false;
        let fg = null, bg = null;

        const openSpan = () => {
            const s = [];
            if (bold) s.push('font-weight:bold');
            if (dim) s.push('opacity:0.6');
            if (italic) s.push('font-style:italic');
            if (underline) s.push('text-decoration:underline');
            if (strike) s.push('text-decoration:line-through');
            if (fg) s.push('color:' + fg);
            if (bg) s.push('background:' + bg);
            return s.length ? '<span style="' + s.join(';') + '">' : '';
        };
        const hasStyle = () => bold || dim || italic || underline || strike || fg || bg;

        while (i < text.length) {
            if (text[i] === '\x1b' && text[i+1] === '[') {
                let j = i + 2;
                while (j < text.length && !/[mKHJABCDG]/.test(text[j])) j++;
                if (j >= text.length) break;
                if (text[j] === 'm') {
                    if (hasStyle()) html += '</span>';
                    const p = text.substring(i+2, j);
                    const codes = p === '' ? [0] : p.split(';').map(Number);
                    for (let ci = 0; ci < codes.length; ci++) {
                        const c = codes[ci];
                        if (c === 0) { bold=dim=italic=underline=strike=false; fg=bg=null; }
                        else if (c===1) bold=true; else if (c===2) dim=true;
                        else if (c===3) italic=true; else if (c===4) underline=true;
                        else if (c===9) strike=true;
                        else if (c===22) { bold=false; dim=false; }
                        else if (c===23) italic=false; else if (c===24) underline=false;
                        else if (c===29) strike=false;
                        else if (c>=30&&c<=37) fg=ANSI_COLORS[c-30];
                        else if (c===38&&codes[ci+1]===5) { fg=ansi256Color(codes[ci+2]); ci+=2; }
                        else if (c===39) fg=null;
                        else if (c>=40&&c<=47) bg=ANSI_COLORS[c-40];
                        else if (c===48&&codes[ci+1]===5) { bg=ansi256Color(codes[ci+2]); ci+=2; }
                        else if (c===49) bg=null;
                        else if (c>=90&&c<=97) fg=ANSI_COLORS[c-90+8];
                        else if (c>=100&&c<=107) bg=ANSI_COLORS[c-100+8];
                    }
                    html += openSpan();
                }
                i = j + 1;
            } else {
                const ch = text[i];
                if (ch === '<') html += '&lt;'; else if (ch === '>') html += '&gt;';
                else if (ch === '&') html += '&amp;'; else html += ch;
                i++;
            }
        }
        if (hasStyle()) html += '</span>';
        return html;
    }

    // Process \r carriage returns (for saved tqdm / progress bar output)
    function processCarriageReturns(text) {
        const result = [];
        let current = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\n') { result.push(current); current = ''; }
            else if (ch === '\r') {
                if (i+1 < text.length && text[i+1] === '\n') continue;
                current = '';
            } else { current += ch; }
        }
        if (current) result.push(current);
        return result.join('\n');
    }

    // ── Rendering ───────────────────────────────────────────────────────

    function renderMarkdownCell(source) {
        const div = document.createElement('div');
        div.className = 'nbv-cell nbv-markdown';
        if (typeof marked !== 'undefined') {
            div.innerHTML = marked.parse(source);
        } else {
            div.textContent = source;
        }
        // Render LaTeX in markdown
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(div, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                ],
                throwOnError: false,
            });
        }
        return div;
    }

    function renderCodeCell(source, executionCount, outputs) {
        const cell = document.createElement('div');
        cell.className = 'nbv-cell nbv-code';

        // Input area
        const input = document.createElement('div');
        input.className = 'nbv-input';

        const prompt = document.createElement('span');
        prompt.className = 'nbv-prompt';
        prompt.textContent = executionCount != null ? `[${executionCount}]` : '[ ]';

        const code = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.className = 'language-python';
        codeEl.textContent = source;
        if (typeof hljs !== 'undefined') {
            hljs.highlightElement(codeEl);
        }
        code.appendChild(codeEl);
        input.append(prompt, code);
        cell.appendChild(input);

        // Outputs
        if (outputs && outputs.length > 0) {
            const outputArea = document.createElement('div');
            outputArea.className = 'nbv-output';
            for (const out of outputs) {
                const rendered = renderOutput(out);
                if (rendered) outputArea.appendChild(rendered);
            }
            if (outputArea.children.length > 0) {
                cell.appendChild(outputArea);
            }
        }

        return cell;
    }

    function renderOutput(output) {
        const type = output.output_type;
        if (type === 'stream') return renderStreamOutput(output);
        if (type === 'execute_result' || type === 'display_data') return renderRichOutput(output);
        if (type === 'error') return renderErrorOutput(output);
        return null;
    }

    function renderStreamOutput(output) {
        const text = textValue(output.text);
        const processed = processCarriageReturns(text);
        const div = document.createElement('div');
        div.className = 'nbv-stream' + (output.name === 'stderr' ? ' nbv-stderr' : '');
        div.innerHTML = ansiToHtml(processed);
        return div;
    }

    function renderRichOutput(output) {
        const data = output.data || {};

        // Priority: HTML > LaTeX > image > SVG > text
        if (data['text/html']) {
            const div = document.createElement('div');
            div.className = 'nbv-html';
            div.innerHTML = textValue(data['text/html']);
            return div;
        }
        if (data['text/latex']) {
            const div = document.createElement('div');
            div.className = 'nbv-latex';
            if (typeof katex !== 'undefined') {
                let tex = textValue(data['text/latex']).trim();
                let displayMode = false;
                if (tex.startsWith('$$') && tex.endsWith('$$')) {
                    tex = tex.slice(2, -2); displayMode = true;
                } else if (tex.startsWith('$') && tex.endsWith('$')) {
                    tex = tex.slice(1, -1);
                }
                katex.render(tex, div, { displayMode, throwOnError: false });
            } else {
                div.textContent = textValue(data['text/latex']);
            }
            return div;
        }
        if (data['image/png']) {
            const img = document.createElement('img');
            img.className = 'nbv-image';
            img.src = 'data:image/png;base64,' + textValue(data['image/png']);
            return img;
        }
        if (data['image/jpeg']) {
            const img = document.createElement('img');
            img.className = 'nbv-image';
            img.src = 'data:image/jpeg;base64,' + textValue(data['image/jpeg']);
            return img;
        }
        if (data['image/svg+xml']) {
            const div = document.createElement('div');
            div.className = 'nbv-svg';
            div.innerHTML = textValue(data['image/svg+xml']);
            return div;
        }
        if (data['text/plain']) {
            const div = document.createElement('div');
            div.className = 'nbv-text';
            div.textContent = textValue(data['text/plain']);
            return div;
        }
        return null;
    }

    function renderErrorOutput(output) {
        const div = document.createElement('div');
        div.className = 'nbv-error';

        const name = document.createElement('div');
        name.className = 'nbv-error-name';
        name.textContent = (output.ename || 'Error') + ': ' + (output.evalue || '');
        div.appendChild(name);

        if (output.traceback && output.traceback.length > 0) {
            const tb = document.createElement('div');
            tb.className = 'nbv-traceback';
            tb.innerHTML = ansiToHtml(output.traceback.join('\n'));
            div.appendChild(tb);
        }
        return div;
    }

    function renderRawCell(source) {
        const div = document.createElement('div');
        div.className = 'nbv-cell nbv-raw';
        div.textContent = source;
        return div;
    }

    // ── Main ────────────────────────────────────────────────────────────

    function renderNotebook(container, notebook, _opts) {
        container.innerHTML = '';
        container.classList.add('nbv-container');

        const cells = notebook.cells || [];
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const source = textValue(cell.source);
            let el;

            if (cell.cell_type === 'markdown') {
                el = renderMarkdownCell(source);
            } else if (cell.cell_type === 'code') {
                const ec = cell.execution_count;
                el = renderCodeCell(source, ec, cell.outputs);
            } else {
                el = renderRawCell(source);
            }

            container.appendChild(el);
        }
    }

    // ── Public API ──────────────────────────────────────────────────────

    root.NotebookViewer = {
        /**
         * Render a notebook into a container.
         * @param {string|HTMLElement} selector - CSS selector or element
         * @param {string|object} source - URL to .ipynb file, or notebook JSON object
         * @param {object} [opts] - Options (reserved for future use)
         */
        render: async function (selector, source, opts) {
            const container = typeof selector === 'string'
                ? document.querySelector(selector) : selector;
            if (!container) {
                console.error('[NotebookViewer] Container not found:', selector);
                return;
            }

            let notebook;
            if (typeof source === 'string') {
                // Fetch from URL
                try {
                    const resp = await fetch(source);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    notebook = await resp.json();
                } catch (e) {
                    container.innerHTML = '<div class="nbv-error">Failed to load notebook: '
                        + escapeHtml(e.message) + '</div>';
                    return;
                }
            } else {
                notebook = source;
            }

            renderNotebook(container, notebook, opts || {});
        },

        /** Render from a notebook JSON object (synchronous). */
        renderJSON: function (selector, notebook, opts) {
            const container = typeof selector === 'string'
                ? document.querySelector(selector) : selector;
            if (!container) return;
            renderNotebook(container, notebook, opts || {});
        }
    };

})(typeof globalThis !== 'undefined' ? globalThis : window);
