/** @odoo-module **/

import { cookie } from "@web/core/browser/cookie";
import {
    Component,
    onMounted,
    onWillUnmount,
    useRef,
    useState,
} from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

export class MoveoSqlConsole extends Component {
    static template = "local_debug.MoveoSqlConsole";

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.rootRef = useRef("root");
        this.state = useState({
            query: "SELECT * FROM res_partner LIMIT 100",
            limit: 0,
            durationMs: 0,
            rowcount: 0,
            headers: [],
            rows: [],
            loading: false,
            error: "",
            executed: false,
        });
        this.onWindowKeydown = this.onWindowKeydown.bind(this);
        this.scrollHostEl = null;

        onMounted(() => {
            this.scrollHostEl = this.rootRef.el?.closest(".o_content");
            if (this.scrollHostEl) {
                this.scrollHostEl.classList.add("o_moveo_sql_console_host");
            }
            window.addEventListener("keydown", this.onWindowKeydown);
        });
        onWillUnmount(() => {
            window.removeEventListener("keydown", this.onWindowKeydown);
            if (this.scrollHostEl) {
                this.scrollHostEl.classList.remove("o_moveo_sql_console_host");
            }
        });
    }

    get hasRows() {
        return this.state.headers.length > 0;
    }

    get hasEmptyResult() {
        return (
            this.state.executed &&
            !this.state.loading &&
            !this.state.error &&
            !this.state.headers.length
        );
    }

    get sqlConsoleThemeClass() {
        return cookie.get("color_scheme") === "dark"
            ? "o_moveo_sql_console_theme_dark"
            : "o_moveo_sql_console_theme_light";
    }

    async execute() {
        const query = (this.state.query || "").trim();
        if (!query) {
            this.notification.add(_t("SQL query is required."), {
                type: "warning",
            });
            return;
        }

        this.state.loading = true;
        this.state.error = "";
        this.state.executed = true;
        try {
            const result = await this.orm.call(
                "local_debug.sql_console.rpc",
                "execute_query",
                [],
                {
                    query,
                    limit: this.state.limit || 0,
                },
            );
            this.state.headers = result.headers || [];
            this.state.rows = result.rows || [];
            this.state.durationMs = result.duration_ms || 0;
            this.state.rowcount = result.rowcount || 0;
        } catch (error) {
            this.state.headers = [];
            this.state.rows = [];
            this.state.durationMs = 0;
            this.state.rowcount = 0;
            this.state.error =
                error?.data?.message ||
                error?.message ||
                _t("Failed to execute SQL query.");
        } finally {
            this.state.loading = false;
        }
    }

    clear() {
        this.state.durationMs = 0;
        this.state.rowcount = 0;
        this.state.headers = [];
        this.state.rows = [];
        this.state.error = "";
        this.state.executed = false;
    }

    onInputQuery(ev) {
        this.state.query = ev.target.value;
    }

    onInputLimit(ev) {
        const parsed = Number.parseInt(ev.target.value || "0", 10);
        this.state.limit = Number.isNaN(parsed) ? 0 : parsed;
    }

    onWindowKeydown(ev) {
        if (this.state.loading || ev.defaultPrevented) {
            return;
        }

        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const cmdOrCtrl = isMac ? ev.metaKey : ev.ctrlKey;
        const key = (ev.key || "").toLowerCase();

        // Cho phép bấm Ctrl + Enter (hoặc Cmd + Enter) hoặc Alt + E để Execute bất cứ lúc nào
        if ((cmdOrCtrl && key === "enter") || (ev.altKey && key === "e")) {
            ev.preventDefault();
            this.execute();
            return;
        }

        // Bấm Alt + R để Clear
        if (ev.altKey && key === "r") {
            ev.preventDefault();
            this.clear();
            return;
        }
    }
}

registry.category("actions").add("local_debug.sql_console", MoveoSqlConsole);
