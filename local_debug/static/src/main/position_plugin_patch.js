/** @odoo-module **/

import { PositionPlugin } from "@html_editor/main/position_plugin";
import { SelectionPlugin } from "@html_editor/core/selection_plugin";
import { CollaborationSelectionPlugin } from "@html_editor/others/collaboration/collaboration_selection_plugin";
import { patch } from "@web/core/utils/patch";
import { debounce } from "@web/core/utils/timing";

/**
 * Strategy: "Hard Scroll Lock"
 * We lock the UI logic during scrolling to achieve peak performance.
 * We only release and update once the scroll has definitively stopped.
 */

// 1. PositionPlugin: Detecting and locking on scroll.
patch(PositionPlugin.prototype, {
    setup() {
        super.setup(...arguments);
        
        // Timer to detect when scroll stops (300ms pause)
        const stopScrollDebounce = debounce(() => {
            if (this.isDestroyed) return;
            window.__odoo_is_scrolling = false;
            // Now that we've stopped, run the original layout update once.
            this._originalLayoutChange();
        }, 300);

        // Save a reference to the Odoo's throttled layout function.
        this._originalLayoutChange = this.layoutGeometryChange.bind(this);

        // We replace it. Now, every scroll event only sets the flag 
        // and resets the "stopped" timer. NO calculation happens during scroll.
        this.layoutGeometryChange = () => {
            window.__odoo_is_scrolling = true;
            stopScrollDebounce();
        };
    }
});

// 2. SelectionPlugin: Block local cursor tracking during scroll.
patch(SelectionPlugin.prototype, {
    updateActiveSelection() {
        if (window.__odoo_is_scrolling) {
            return;
        }
        return super.updateActiveSelection(...arguments);
    }
});

// 3. CollaborationSelection: Block peer cursor/selection updates during scroll.
patch(CollaborationSelectionPlugin.prototype, {
    refreshSelection() {
        if (window.__odoo_is_scrolling) {
            return;
        }
        return super.refreshSelection(...arguments);
    },
    updateSelection() {
        if (window.__odoo_is_scrolling) {
            return;
        }
        return super.updateSelection(...arguments);
    }
});
