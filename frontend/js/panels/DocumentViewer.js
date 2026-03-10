/**
 * DocumentViewer - Renders Markdown and PDF documents in the center pane.
 * Adapted from docbro's DocumentLoader + PdfRenderer for noted integration.
 */
export class DocumentViewer {
    constructor() {
        this._wrapper = document.createElement('div');
        this._wrapper.className = 'document-viewer-wrapper';

        this._content = document.createElement('div');
        this._content.className = 'document-viewer-content';
        this._wrapper.appendChild(this._content);

        this._currentDoc = null;
        this._pdfState = null; // { pdfDoc, pageDivs, observers, renderVersion }
        this._pdfModule = null; // lazy-loaded pdf.js module
    }

    get element() { return this._wrapper; }

    /**
     * Load and display a document.
     * @param {object} doc - { name, category, location }
     */
    async show(doc) {
        this._cleanup();
        this._currentDoc = doc;
        this._content.innerHTML = '';

        const isPdf = doc.location.toLowerCase().endsWith('.pdf');
        const url = `api/documents/files/${encodeURIComponent(doc.location.replace('files/', ''))}`;

        if (isPdf) {
            await this._renderPdf(url);
        } else {
            await this._renderMarkdown(url);
        }
    }

    clear() {
        this._cleanup();
        this._currentDoc = null;
        this._content.innerHTML = '';
    }

    // --- Markdown rendering ---

    async _renderMarkdown(url) {
        this._content.className = 'document-viewer-content document-viewer-markdown';

        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const markdown = await resp.text();
            const html = this._renderMarkdownToHtml(markdown);
            this._content.innerHTML = html;
            this._postProcessMarkdown();
        } catch (err) {
            this._content.innerHTML = `<div class="document-viewer-error">Failed to load document: ${err.message}</div>`;
        }
    }

    _renderMarkdownToHtml(markdown) {
        const mathExpressions = [];
        let mathIndex = 0;

        // Extract display math
        markdown = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
            const placeholder = `MATH_DISPLAY_${mathIndex}`;
            mathExpressions.push({ type: 'display', math: math.trim(), placeholder });
            mathIndex++;
            return placeholder;
        });

        // Extract inline math
        markdown = markdown.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
            const placeholder = `MATH_INLINE_${mathIndex}`;
            mathExpressions.push({ type: 'inline', math: math.trim(), placeholder });
            mathIndex++;
            return placeholder;
        });

        // Parse markdown (marked is loaded as a UMD global)
        let html = marked.parse(markdown);

        // Restore math with KaTeX (katex is loaded as a UMD global)
        for (const item of mathExpressions) {
            try {
                const rendered = katex.renderToString(item.math, {
                    displayMode: item.type === 'display',
                    throwOnError: false,
                });
                html = html.replace(item.placeholder, rendered);
            } catch {
                const fallback = item.type === 'display'
                    ? `$$${item.math}$$`
                    : `$${item.math}$`;
                html = html.replace(item.placeholder, fallback);
            }
        }

        return html;
    }

    _postProcessMarkdown() {
        // Syntax highlighting (hljs is loaded as a UMD global)
        if (typeof hljs !== 'undefined') {
            this._content.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    }

    // --- PDF rendering ---

    async _renderPdf(url) {
        this._content.className = 'document-viewer-content document-viewer-pdf';

        try {
            if (!this._pdfModule) {
                this._pdfModule = await import('/static/vendor/pdf.min.mjs');
                this._pdfModule.GlobalWorkerOptions.workerSrc = '/static/vendor/pdf.worker.min.mjs';
            }

            const pdfDoc = await this._pdfModule.getDocument({ url }).promise;
            const renderVersion = Date.now();

            const state = {
                pdfDoc,
                pageDivs: [],
                overlayEntries: [],
                intersectionObserver: null,
                unloadObserver: null,
                renderQueue: [],
                activeRenders: 0,
                renderVersion,
                resizeObserver: null,
            };
            this._pdfState = state;

            await this._setupPdfPlaceholders(state);
            this._startPdfLazyRendering(state);
        } catch (err) {
            this._content.innerHTML = `<div class="document-viewer-error">Failed to load PDF: ${err.message}</div>`;
        }
    }

    async _setupPdfPlaceholders(state) {
        const { pdfDoc, renderVersion } = state;
        const numPages = pdfDoc.numPages;
        const scale = 1.5;

        for (let i = 0; i < numPages; i++) {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'pdf-page';

            try {
                const page = await pdfDoc.getPage(i + 1);
                if (state.renderVersion !== renderVersion) return;

                const viewport = page.getViewport({ scale });
                const outputScale = new this._pdfModule.OutputScale();
                pageDiv.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
                pageDiv._pdfPage = page;
                pageDiv._pdfViewport = viewport;
                pageDiv._pdfOutputScale = outputScale;
            } catch {
                pageDiv.style.aspectRatio = '8.5 / 11';
            }

            pageDiv._renderState = 'idle';
            pageDiv._pageRenderVersion = 0;
            pageDiv._pageIndex = i;

            this._content.appendChild(pageDiv);
            state.pageDivs.push(pageDiv);
        }

        // Resize observer for annotation overlays
        state.resizeObserver = new ResizeObserver(() => {
            for (const entry of state.overlayEntries) {
                const pd = entry.div.parentElement;
                if (pd) {
                    const dw = pd.clientWidth;
                    if (dw > 0) {
                        entry.div.style.transform = `scale(${dw / entry.viewport.width})`;
                    }
                }
            }
        });
        state.resizeObserver.observe(this._content);
    }

    _startPdfLazyRendering(state) {
        const { renderVersion, pageDivs } = state;

        // Render observer: trigger when pages approach viewport
        state.intersectionObserver = new IntersectionObserver((entries) => {
            if (state.renderVersion !== renderVersion) return;
            for (const entry of entries) {
                const pageDiv = entry.target;
                if (entry.isIntersecting) {
                    if (pageDiv._renderState === 'idle' || pageDiv._renderState === 'unloaded') {
                        if (!state.renderQueue.includes(pageDiv)) {
                            state.renderQueue.push(pageDiv);
                        }
                    }
                }
            }
            this._processPdfRenderQueue(state);
        }, {
            root: this._wrapper,
            rootMargin: '200% 0px',
        });

        // Unload observer: reclaim memory for far-away pages
        state.unloadObserver = new IntersectionObserver((entries) => {
            if (state.renderVersion !== renderVersion) return;
            for (const entry of entries) {
                if (!entry.isIntersecting && entry.target._renderState === 'rendered') {
                    this._unloadPdfPage(entry.target, state);
                }
            }
        }, {
            root: this._wrapper,
            rootMargin: '500% 0px',
        });

        for (const pageDiv of pageDivs) {
            state.intersectionObserver.observe(pageDiv);
            state.unloadObserver.observe(pageDiv);
        }
    }

    _processPdfRenderQueue(state) {
        const maxConcurrent = 2;
        while (state.activeRenders < maxConcurrent && state.renderQueue.length > 0) {
            // Sort: pages closest to scroll center first
            const scrollCenter = this._wrapper.scrollTop + this._wrapper.clientHeight / 2;
            state.renderQueue.sort((a, b) => {
                const aDist = Math.abs(a.offsetTop + a.offsetHeight / 2 - scrollCenter);
                const bDist = Math.abs(b.offsetTop + b.offsetHeight / 2 - scrollCenter);
                return aDist - bDist;
            });

            const pageDiv = state.renderQueue.shift();
            if (pageDiv._renderState === 'rendered' || pageDiv._renderState === 'rendering') continue;
            if (!pageDiv._pdfPage) continue;

            state.activeRenders++;
            pageDiv._renderState = 'rendering';

            this._renderPdfPage(pageDiv, state).then(() => {
                state.activeRenders--;
                this._processPdfRenderQueue(state);
            });
        }
    }

    async _renderPdfPage(pageDiv, state) {
        const page = pageDiv._pdfPage;
        const viewport = pageDiv._pdfViewport;
        const outputScale = pageDiv._pdfOutputScale;
        const pageRenderVersion = ++pageDiv._pageRenderVersion;
        const { renderVersion, pdfDoc } = state;

        if (!page || !viewport || !outputScale) {
            pageDiv._renderState = 'idle';
            return;
        }

        // Canvas render
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale.sx);
        canvas.height = Math.floor(viewport.height * outputScale.sy);
        const ctx = canvas.getContext('2d');

        try {
            await page.render({
                canvasContext: ctx,
                viewport,
                transform: outputScale.scaled ? [outputScale.sx, 0, 0, outputScale.sy, 0, 0] : null,
            }).promise;
        } catch {
            pageDiv._renderState = pageDiv._renderState === 'rendering' ? 'idle' : pageDiv._renderState;
            return;
        }

        // Staleness checks
        if (state.renderVersion !== renderVersion) return;
        if (pageDiv._pageRenderVersion !== pageRenderVersion) return;
        if (pageDiv._renderState !== 'rendering') return;

        pageDiv.appendChild(canvas);
        pageDiv.style.aspectRatio = '';

        // Text layer
        try {
            const textContent = await page.getTextContent();
            if (state.renderVersion !== renderVersion || pageDiv._pageRenderVersion !== pageRenderVersion) return;

            const displayedWidth = pageDiv.clientWidth || viewport.width;
            const textScale = displayedWidth / page.getViewport({ scale: 1 }).width;
            const textViewport = page.getViewport({ scale: textScale });

            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'textLayer';
            textLayerDiv.style.setProperty('--scale-factor', textScale);
            pageDiv.appendChild(textLayerDiv);

            const textLayer = new this._pdfModule.TextLayer({
                textContentSource: textContent,
                container: textLayerDiv,
                viewport: textViewport,
            });
            await textLayer.render();
        } catch {
            // Text layer is optional
        }

        // Annotation overlay (links)
        try {
            const annotations = await page.getAnnotations();
            if (state.renderVersion !== renderVersion || pageDiv._pageRenderVersion !== pageRenderVersion) return;

            const linkAnnotations = annotations.filter(a => a.subtype === 'Link' && (a.dest || a.url));
            if (linkAnnotations.length > 0) {
                const annotationDiv = document.createElement('div');
                annotationDiv.className = 'annotationLayer';
                annotationDiv.style.width = viewport.width + 'px';
                annotationDiv.style.height = viewport.height + 'px';
                pageDiv.appendChild(annotationDiv);

                for (const annot of linkAnnotations) {
                    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(annot.rect);
                    const left = Math.min(x1, x2);
                    const top = Math.min(y1, y2);
                    const width = Math.abs(x2 - x1);
                    const height = Math.abs(y2 - y1);

                    const link = document.createElement('a');
                    link.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;

                    if (annot.url) {
                        link.href = annot.url;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                    } else if (annot.dest) {
                        link.href = '#';
                        link.addEventListener('click', async (e) => {
                            e.preventDefault();
                            try {
                                let dest = annot.dest;
                                if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
                                if (!Array.isArray(dest)) return;
                                const ref = dest[0];
                                const pageIndex = typeof ref === 'number' ? ref : await pdfDoc.getPageIndex(ref);
                                const targetDiv = state.pageDivs[pageIndex];
                                if (targetDiv) {
                                    targetDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            } catch {}
                        });
                    }

                    annotationDiv.appendChild(link);
                }

                state.overlayEntries.push({ div: annotationDiv, viewport });
            }
        } catch {
            // Annotations are optional
        }

        pageDiv._renderState = 'rendered';
    }

    _unloadPdfPage(pageDiv, state) {
        if (pageDiv._renderState !== 'rendered') return;
        pageDiv._pageRenderVersion++;

        const canvas = pageDiv.querySelector('canvas');
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
            canvas.remove();
        }

        const textLayer = pageDiv.querySelector('.textLayer');
        if (textLayer) textLayer.remove();

        const annotLayer = pageDiv.querySelector('.annotationLayer');
        if (annotLayer) {
            state.overlayEntries = state.overlayEntries.filter(e => e.div !== annotLayer);
            annotLayer.remove();
        }

        if (pageDiv._pdfViewport) {
            const vp = pageDiv._pdfViewport;
            pageDiv.style.aspectRatio = `${vp.width} / ${vp.height}`;
        }

        pageDiv._renderState = 'unloaded';
    }

    _cleanup() {
        if (!this._pdfState) return;
        const state = this._pdfState;

        state.renderVersion = -1; // invalidate any in-flight renders

        if (state.intersectionObserver) state.intersectionObserver.disconnect();
        if (state.unloadObserver) state.unloadObserver.disconnect();
        if (state.resizeObserver) state.resizeObserver.disconnect();

        for (const pageDiv of state.pageDivs) {
            const canvas = pageDiv.querySelector('canvas');
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        }

        if (state.pdfDoc) {
            state.pdfDoc.destroy();
        }

        this._pdfState = null;
    }
}
