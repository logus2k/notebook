/**
 * NotebookResizer - Draggable splitter between notebook area and right panel.
 * Replaces the width slider in DisplaySettingsPanel.
 */
export class NotebookResizer {
    constructor() {
        this._resizer = document.getElementById('notebook-resizer');
        this._container = document.getElementById('center-column');

        // Restore saved width
        const saved = localStorage.getItem('notebook-cell-width');
        if (saved) {
            const px = parseInt(saved, 10);
            this._container.style.width = (px + 28) + 'px';
        }

        this._setupDrag();
    }

    _setupDrag() {
        let startX, startWidth, rafId;

        this._resizer.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            this._resizer.classList.add('dragging');
            document.body.classList.add('resizing');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
            // Contain layout during drag to limit reflow scope
            this._container.style.contain = 'inline-size layout style';
            startX = e.clientX;
            startWidth = this._container.getBoundingClientRect().width;
            rafId = 0;

            const onMouseMove = (e) => {
                if (rafId) return;
                rafId = requestAnimationFrame(() => {
                    const dx = e.clientX - startX;
                    const newWidth = Math.max(400, Math.min(startWidth + dx, window.innerWidth - 100));
                    this._container.style.width = newWidth + 'px';
                    rafId = 0;
                });
            };

            const onMouseUp = () => {
                if (rafId) cancelAnimationFrame(rafId);
                this._resizer.classList.remove('dragging');
                document.body.classList.remove('resizing');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                this._container.style.contain = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // Save as cell width (subtract padding)
                const containerWidth = this._container.getBoundingClientRect().width;
                const cellWidth = Math.round(containerWidth - 28);
                localStorage.setItem('notebook-cell-width', String(cellWidth));
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }
}
