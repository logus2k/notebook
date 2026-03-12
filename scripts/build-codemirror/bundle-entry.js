// Core state & view
export {
    EditorState,
    Compartment,
    RangeSetBuilder,
    StateField,
    StateEffect,
} from '@codemirror/state';

export {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    Decoration,
    ViewPlugin,
    WidgetType,
} from '@codemirror/view';

// Commands
export {
    defaultKeymap,
    indentWithTab,
    history,
    historyKeymap,
} from '@codemirror/commands';

// Language support
export {
    syntaxHighlighting,
    HighlightStyle,
    defaultHighlightStyle,
} from '@codemirror/language';

export { tags } from '@lezer/highlight';

// Language packs
export { python } from '@codemirror/lang-python';
export { markdown } from '@codemirror/lang-markdown';

// Themes
export { oneDark } from '@codemirror/theme-one-dark';
export { ayuLight, clouds, espresso, smoothy, tomorrow } from 'thememirror';
