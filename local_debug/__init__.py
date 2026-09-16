# -*- coding: utf-8 -*-

import logging

from odoo.modules.neutralize import neutralize_database
from odoo.tools import config
from odoo.tools.misc import str2bool

from . import controllers
from . import models

class WerkzeugLocalDebugFilter(logging.Filter):
    def filter(self, record):
        if record.args:
            # Odoo/Werkzeug logs typically pass the request path in args
            return not any('/local_debug/runtime' in str(arg) for arg in record.args)
        return '/local_debug/runtime' not in record.getMessage()

class IrAttachmentLocalDebugFilter(logging.Filter):
    def filter(self, record):
        # Ignore annoying FileNotFoundError logs when local database is missing filestore attachments
        if getattr(record, 'msg', '') and isinstance(record.msg, str) and record.msg.startswith('_read_file reading'):
            return False
        return True

logging.getLogger('werkzeug').addFilter(WerkzeugLocalDebugFilter())
logging.getLogger('odoo.addons.base.models.ir_attachment').addFilter(IrAttachmentLocalDebugFilter())

_logger = logging.getLogger(__name__)
_NEUTRALIZE_BANNER_VIEW_KEYS = (
    "web.neutralize_banner",
    "website.neutralize_ribbon",
)


def _get_config_value(*keys):
    for key in keys:
        if not key:
            continue
        value = config.get(key)
        if value not in (None, ""):
            return value
    return None


def _get_bool_config(*keys, default=False):
    value = _get_config_value(*keys)
    if value is None:
        return default
    return str2bool(str(value), default)


def is_local_debug_enabled():
    return _get_bool_config(
        "local_debug",
        "local_debug_login",
        default=False,
    )


def _disable_all_scheduled_actions(env):
    env.cr.execute("UPDATE ir_cron SET active = false WHERE active IS TRUE")


def _hide_neutralize_banner_views(env):
    views = (
        env["ir.ui.view"]
        .sudo()
        .with_context(active_test=False)
        .search([("key", "in", list(_NEUTRALIZE_BANNER_VIEW_KEYS)), ("active", "=", True)])
    )
    if views:
        hidden_keys = ", ".join(views.mapped("key"))
        views.write({"active": False})
        _logger.info("Local debug hid neutralize banner views: %s", hidden_keys)


def apply_local_debug_neutralization(env):
    """
    Reuse Odoo neutralization to disable background/external integrations
    for local debug databases. The neutralization is intentionally applied once
    because Odoo's SQL scripts are not fully idempotent.
    """
    if not is_local_debug_enabled():
        return False

    ir_config = env["ir.config_parameter"].sudo()
    database_is_neutralized = str2bool(
        str(ir_config.get_param("database.is_neutralized", default=False)),
        False,
    )

    if not database_is_neutralized:
        neutralize_database(env.cr)
        _logger.info("Local debug neutralization applied through Odoo core neutralize.")
    else:
        _logger.info("Core neutralization already present, applying local debug hardening only.")
    _disable_all_scheduled_actions(env)
    _hide_neutralize_banner_views(env)
    _logger.info("Local debug disabled all scheduled actions.")
    return True


def post_init_hook(env):
    apply_local_debug_neutralization(env)
