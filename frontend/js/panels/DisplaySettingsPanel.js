import { CellEditor, editorThemes } from '../CellEditor.js';
import { terminalThemes, setTerminalTheme } from '../TerminalThemes.js';

/**
 * DisplaySettingsPanel - jsPanel floating window for display settings.
 */
export class DisplaySettingsPanel {
    constructor() {
        this._panel = null;
    }

    open() {
        if (this._panel) {
            this._panel.front();
            return;
        }

        this._panel = jsPanel.create({
            id: 'display-settings-panel',
            headerTitle: 'Settings',
            theme: 'none',
            borderRadius: '5px',
            border: '1px solid var(--border-color)',
            boxShadow: 3,
            position: { my: 'right-top', at: 'right-top', offsetX: -60, offsetY: 100 },
            panelSize: { width: 320, height: 450 },
            headerControls: { minimize: 'remove', smallify: 'remove', normalize: 'remove', maximize: 'remove' },
            onclosed: () => { this._panel = null; },
            callback: (panel) => {
                this._panel = panel;
                this._buildContent(panel.content);
            }
        });
    }

    close() {
        if (this._panel) {
            this._panel.close();
            this._panel = null;
        }
    }

    toggle() {
        if (this._panel) this.close();
        else this.open();
    }

    _buildContent(container) {
        container.innerHTML = '';
        container.style.padding = '12px 16px';
        container.style.overflowY = 'auto';

        // Cell width slider
        const sliderRow = document.createElement('div');
        sliderRow.className = 'settings-slider-row';

        const sliderLabel = document.createElement('label');
        sliderLabel.textContent = 'Cell Width';

        const sliderValue = document.createElement('span');
        sliderValue.className = 'settings-slider-value';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '350';
        slider.step = '10';
        slider.className = 'settings-slider';

        const getMaxWidth = () => {
            return window.innerWidth - 80;
        };

        const applyWidth = (val) => {
            const max = parseInt(slider.max, 10);
            const isFull = val >= max;
            sliderValue.textContent = isFull ? 'Full' : `${val}px`;
            document.documentElement.style.setProperty('--notebook-max-width', isFull ? 'none' : `${val}px`);
        };

        slider.max = String(getMaxWidth());
        const saved = localStorage.getItem('notebook-cell-width');
        const initial = saved ? parseInt(saved, 10) : 960;
        slider.value = String(initial);
        applyWidth(initial);

        slider.addEventListener('input', () => {
            const val = parseInt(slider.value, 10);
            applyWidth(val);
            localStorage.setItem('notebook-cell-width', String(val));
        });

        window.addEventListener('resize', () => {
            slider.max = String(getMaxWidth());
        });

        sliderRow.append(sliderLabel, sliderValue);
        container.append(sliderRow, slider);

        // Editor theme selector
        const themeRow = document.createElement('div');
        themeRow.className = 'settings-toggle-row';

        const themeLabel = document.createElement('label');
        themeLabel.textContent = 'Editor Theme';

        const themeSelect = document.createElement('select');
        themeSelect.className = 'settings-theme-select';
        const savedTheme = localStorage.getItem('notebook-editor-theme') || 'Tomorrow';
        for (const name of Object.keys(editorThemes)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === savedTheme) opt.selected = true;
            themeSelect.appendChild(opt);
        }
        themeSelect.addEventListener('change', () => {
            CellEditor.setTheme(themeSelect.value);
        });

        themeRow.append(themeLabel, themeSelect);
        container.appendChild(themeRow);

        // Terminal theme selector
        const termRow = document.createElement('div');
        termRow.className = 'settings-toggle-row';

        const termLabel = document.createElement('label');
        termLabel.textContent = 'Terminal Theme';

        const termSelect = document.createElement('select');
        termSelect.className = 'settings-theme-select';
        const savedTermTheme = localStorage.getItem('notebook-terminal-theme') || 'Adventure';
        for (const name of Object.keys(terminalThemes)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (name === savedTermTheme) opt.selected = true;
            termSelect.appendChild(opt);
        }
        termSelect.addEventListener('change', () => {
            setTerminalTheme(termSelect.value);
        });

        termRow.append(termLabel, termSelect);
        container.appendChild(termRow);

        // Display toggles
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
}
