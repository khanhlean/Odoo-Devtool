# -*- coding: utf-8 -*-
{
    "name": "Local Debug",
    "summary": "Local-only debug tools for Odoo development",
    "version": "19.0.1.7.0",
    "category": "Tools",
    "depends": ["web", "mail", "html_editor"],
    "data": [
        "views/web_login_templates.xml",
        "views/moveo_sql_console_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "local_debug/static/src/utils/*.js",
            "local_debug/static/src/sql_console/*.js",
            "local_debug/static/src/sql_console/*.xml",
            "local_debug/static/src/sql_console/*.scss",

            "local_debug/static/src/core/debug/*.js",
            "local_debug/static/src/core/debug/*.xml",

            "local_debug/static/src/local_debug_hud/*.xml",
            "local_debug/static/src/local_debug_hud/*.scss",

            "local_debug/static/src/webclient/webclient_patch_actions.js",
            "local_debug/static/src/webclient/webclient_patch_perf.js",
            "local_debug/static/src/webclient/webclient_patch_runtime.js",
            "local_debug/static/src/webclient/webclient_patch_view_info.js",
            "local_debug/static/src/webclient/webclient_patch_chatter.js",
            "local_debug/static/src/webclient/webclient_patch.js",

            "local_debug/static/src/webclient/*.xml",

            "local_debug/static/src/webclient/user_menu/*.js",
            "local_debug/static/src/webclient/user_menu/*.xml",
            
            "local_debug/static/src/webclient/navbar/*.scss",
        ],
        'html_editor.assets_editor': [
            'local_debug/static/src/main/position_plugin_patch.js',
            'local_debug/static/src/main/editor_optimize.scss',
        ],
    },
    "post_init_hook": "post_init_hook",
    "installable": True,
    "application": True,
    "license": "LGPL-3",
    "author": "khanhlean",
}
