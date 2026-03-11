/**
 * PythonFileEditor - CodeMirror-based editor for Python source files.
 * Edit-only: no execution UI. Supports Ctrl+S save and dirty tracking.
 */
import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    EditorState, Compartment,
    defaultKeymap, indentWithTab, history, historyKeymap,
    syntaxHighlighting, defaultHighlightStyle,
    python,
    ayuLight, clouds, espresso, smoothy, tomorrow, oneDark
} from '../vendor/codemirror/codemirror.bundle.js';

import { notify } from './Notify.js';

const editorThemes = {
    'Default': null,
    'Ayu Light': ayuLight,
    'Clouds': clouds,
    'Espresso': espresso,
    'Smoothy': smoothy,
    'Tomorrow': tomorrow,
    'One Dark': oneDark
};

/** Track all PythonFileEditor instances for theme reconfiguration. */
const _allEditors = new Set();
const _themeCompartment = new Compartment();

export class PythonFileEditor {
    constructor() {
        this._el = document.createElement('div');
        this._el.className = 'python-file-editor';

        this._editorView = null;
        this._projectId = null;
        this._filename = null;
        this._dirty = false;
        this._onDirtyChange = null;
    }

    get element() { return this._el; }
    get projectId() { return this._projectId; }
    get filename() { return this._filename; }
    get isDirty() { return this._dirty; }

    set onDirtyChange(cb) { this._onDirtyChange = cb; }

    async open(projectId, filename) {
        this._projectId = projectId;
        this._filename = filename;
        this._dirty = false;

        const resp = await fetch(`api/projects/${encodeURIComponent(projectId)}/src/${encodeURIComponent(filename)}`);
        if (!resp.ok) {
            notify.error(`Failed to load ${filename}`);
            return;
        }
        const data = await resp.json();
        this._createEditor(data.content || '');
    }

    _createEditor(content) {
        if (this._editorView) {
            _allEditors.delete(this._editorView);
            this._editorView.destroy();
        }
        this._el.innerHTML = '';

        const savedThemeName = localStorage.getItem('notebook-editor-theme') || 'Tomorrow';
        const initialTheme = editorThemes[savedThemeName] || [];

        const extensions = [
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            history(),
            syntaxHighlighting(defaultHighlightStyle),
            keymap.of([
                { key: 'Mod-s', run: () => { this.save(); return true; } },
                ...defaultKeymap,
                ...historyKeymap,
                indentWithTab
            ]),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && !this._dirty) {
                    this._dirty = true;
                    if (this._onDirtyChange) this._onDirtyChange(true);
                }
            }),
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' }
            }),
            python(),
            EditorView.lineWrapping,
            _themeCompartment.of(initialTheme)
        ];

        this._editorView = new EditorView({
            state: EditorState.create({ doc: content, extensions }),
            parent: this._el
        });

        _allEditors.add(this._editorView);
    }

    async save() {
        if (!this._projectId || !this._filename || !this._editorView) return;
        const content = this._editorView.state.doc.toString();
        const resp = await fetch(
            `api/projects/${encodeURIComponent(this._projectId)}/src/${encodeURIComponent(this._filename)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            }
        );
        if (resp.ok) {
            this._dirty = false;
            if (this._onDirtyChange) this._onDirtyChange(false);
            notify.success(`${this._filename} saved`);
        } else {
            notify.error(`Failed to save ${this._filename}`);
        }
    }

    getContent() {
        return this._editorView ? this._editorView.state.doc.toString() : '';
    }

    destroy() {
        if (this._editorView) {
            _allEditors.delete(this._editorView);
            this._editorView.destroy();
            this._editorView = null;
        }
        this._el.innerHTML = '';
        this._projectId = null;
        this._filename = null;
        this._dirty = false;
    }

    /** Reconfigure theme on all open Python file editors. */
    static setTheme(themeName) {
        const theme = editorThemes[themeName] || [];
        for (const view of _allEditors) {
            view.dispatch({
                effects: _themeCompartment.reconfigure(theme)
            });
        }
    }
}
