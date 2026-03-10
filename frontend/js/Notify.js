/**
 * Notify — thin singleton wrapper around Notyf.
 * Usage:
 *   import { notify } from './Notify.js';
 *   notify.success('Saved');
 *   notify.error('Something went wrong');
 */

let instance = null;

function get() {
    if (!instance) {
        instance = new Notyf({
            duration: 2500,
            ripple: false,
            dismissible: true,
            position: { x: 'right', y: 'bottom' },
        });
    }
    return instance;
}

export const notify = {
    success(msg) { get().success(msg); },
    error(msg)   { get().error(msg); },
    open(opts)   { get().open(opts); },
    dismissAll() { get().dismissAll(); },
};
