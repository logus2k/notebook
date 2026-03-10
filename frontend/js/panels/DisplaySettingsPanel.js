import { CellEditor, editorThemes } from '../CellEditor.js';
import { terminalThemes, setTerminalTheme } from '../TerminalThemes.js';

/**
 * DisplaySettingsPanel - Settings UI hosted in the center tab pane.
 * Organized into sections: Editor, Terminal, Notebook.
 */
export class DisplaySettingsPanel {
    constructor() {
        this._wrapper = document.createElement('div');
        this._wrapper.className = 'settings-panel-wrapper';

        this._content = document.createElement('div');
        this._content.className = 'settings-panel-content';
        this._wrapper.appendChild(this._content);

        this._buildContent(this._content);
    }

    get element() {
        return this._wrapper;
    }

    _buildContent(container) {
        // --- Editor section ---
        this._addSection(container, 'Editor');
        this._addSelectRow(container, 'Theme', 'settings-theme-select',
            Object.keys(editorThemes),
            localStorage.getItem('notebook-editor-theme') || 'Tomorrow',
            (val) => CellEditor.setTheme(val),
        );

        // --- Terminal section ---
        this._addSection(container, 'Terminal');
        this._addSelectRow(container, 'Theme', 'settings-theme-select',
            Object.keys(terminalThemes),
            localStorage.getItem('notebook-terminal-theme') || 'Adventure',
            (val) => setTerminalTheme(val),
        );

        // --- Notebook section ---
        this._addSection(container, 'Notebook');

        const toggles = [
            { key: 'show-cell-titles', label: 'Cell Titles', bodyClass: 'hide-cell-titles', defaultOn: true },
            { key: 'show-cell-borders', label: 'Cell Borders', bodyClass: 'hide-cell-borders', defaultOn: true },
            { key: 'show-cell-bg', label: 'Cells Background', bodyClass: 'hide-cell-bg', defaultOn: true },
            { key: 'show-code-cells', label: 'Code Cells', bodyClass: 'hide-code-cells', defaultOn: true },
            { key: 'show-line-numbers', label: 'Line Numbers', bodyClass: 'hide-line-numbers', defaultOn: true },
            { key: 'show-output', label: 'Output Cells', bodyClass: 'hide-output', defaultOn: true },
            { key: 'show-table-stripes', label: 'Alternating Row Shading', bodyClass: 'hide-table-stripes', defaultOn: true },
            { key: 'show-add-cell-areas', label: 'Add Cell Buttons', bodyClass: 'hide-add-cell-areas', defaultOn: true },
            { key: 'show-bg-image', label: 'Background Image', bodyClass: 'hide-bg-image', defaultOn: true },
            { key: 'show-bg-color', label: 'Background Color', bodyClass: 'hide-bg-color', defaultOn: true },
        ];

        for (const t of toggles) {
            const savedVal = localStorage.getItem(`notebook-${t.key}`);
            const isOn = savedVal !== null ? savedVal === '1' : t.defaultOn;
            if (!isOn) document.body.classList.add(t.bodyClass);

            const row = document.createElement('div');
            row.className = 'settings-toggle-row';

            const label = document.createElement('label');
            label.textContent = t.label;

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'settings-toggle';
            toggle.checked = isOn;
            toggle.addEventListener('change', () => {
                if (toggle.checked) {
                    document.body.classList.remove(t.bodyClass);
                } else {
                    document.body.classList.add(t.bodyClass);
                }
                localStorage.setItem(`notebook-${t.key}`, toggle.checked ? '1' : '0');
            });

            row.append(label, toggle);
            container.appendChild(row);
        }
    }

    _addSection(container, title) {
        const heading = document.createElement('div');
        heading.className = 'settings-section-heading';
        heading.textContent = title;
        container.appendChild(heading);

        const hr = document.createElement('hr');
        hr.className = 'settings-section-hr';
        container.appendChild(hr);
    }

    _addSelectRow(container, label, className, options, selectedValue, onChange) {
        const row = document.createElement('div');
        row.className = 'settings-toggle-row';

        const lbl = document.createElement('label');
        lbl.textContent = label;

        const select = document.createElement('select');
        select.className = className;
        for (const name of options) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === selectedValue) opt.selected = true;
            select.appendChild(opt);
        }
        select.addEventListener('change', () => onChange(select.value));

        row.append(lbl, select);
        container.appendChild(row);
    }
}
