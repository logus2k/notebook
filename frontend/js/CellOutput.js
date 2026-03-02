/**
 * CellOutput - Renders cell outputs (text, images, HTML, errors).
 */
export class CellOutput {
    constructor() {
        this._el = document.createElement('div');
        this._el.className = 'cell-output';
        this._outputs = [];
    }

    get element() { return this._el; }

    clear() {
        this._outputs = [];
        this._el.innerHTML = '';
    }

    showExecuting() {
        this.clear();
        const div = document.createElement('div');
        div.className = 'output-executing';
        div.innerHTML = '<div class="spinner"></div><span>Running...</span>';
        this._el.appendChild(div);
    }

    addOutput(output) {
        const executing = this._el.querySelector('.output-executing');
        if (executing) executing.remove();

        this._outputs.push(output);
        const rendered = this._renderOutput(output);
        if (rendered) {
            this._el.appendChild(rendered);
        }
    }

    setOutputs(outputs) {
        this.clear();
        for (const output of outputs) {
            this.addOutput(output);
        }
    }

    _renderOutput(output) {
        switch (output.output_type) {
            case 'stream': return this._renderStream(output);
            case 'execute_result': return this._renderResult(output);
            case 'display_data': return this._renderDisplay(output);
            case 'error': return this._renderError(output);
            default: return null;
        }
    }

    _renderStream(output) {
        const div = document.createElement('div');
        div.className = `output-stream ${output.name === 'stderr' ? 'stderr' : ''}`;
        div.textContent = output.text || '';
        return div;
    }

    _renderResult(output) {
        const data = output.data || {};
        if (data['text/html']) return this._renderHTML(data['text/html']);
        if (data['image/png']) return this._renderImage(data['image/png'], 'image/png');
        if (data['image/svg+xml']) return this._renderSVG(data['image/svg+xml']);

        const div = document.createElement('div');
        div.className = 'output-result';
        div.textContent = data['text/plain'] || '';
        return div;
    }

    _renderDisplay(output) {
        const data = output.data || {};
        const container = document.createElement('div');
        container.className = 'output-display';

        if (data['image/png']) {
            container.appendChild(this._renderImage(data['image/png'], 'image/png'));
        } else if (data['image/jpeg']) {
            container.appendChild(this._renderImage(data['image/jpeg'], 'image/jpeg'));
        } else if (data['image/svg+xml']) {
            container.appendChild(this._renderSVG(data['image/svg+xml']));
        } else if (data['text/html']) {
            container.appendChild(this._renderHTML(data['text/html']));
        } else if (data['application/json']) {
            container.appendChild(this._renderJSON(data['application/json']));
        } else if (data['text/plain']) {
            const div = document.createElement('div');
            div.className = 'output-result';
            div.textContent = data['text/plain'];
            container.appendChild(div);
        }
        return container;
    }

    _renderError(output) {
        const div = document.createElement('div');
        div.className = 'output-error';

        const name = document.createElement('div');
        name.className = 'error-name';
        name.textContent = `${output.ename || 'Error'}: ${output.evalue || ''}`;
        div.appendChild(name);

        if (output.traceback && output.traceback.length > 0) {
            const tb = document.createElement('div');
            tb.className = 'error-traceback';
            tb.textContent = output.traceback.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
            div.appendChild(tb);
        }
        return div;
    }

    _renderImage(base64Data, mimeType) {
        const img = document.createElement('img');
        img.src = `data:${mimeType};base64,${base64Data}`;
        return img;
    }

    _renderSVG(svgString) {
        const div = document.createElement('div');
        div.className = 'output-display';
        div.innerHTML = svgString;
        return div;
    }

    _renderHTML(htmlString) {
        const div = document.createElement('div');
        div.className = 'output-display-html';
        div.innerHTML = htmlString;
        return div;
    }

    _renderJSON(jsonData) {
        const div = document.createElement('div');
        div.className = 'output-json';
        div.textContent = JSON.stringify(jsonData, null, 2);
        return div;
    }
}
