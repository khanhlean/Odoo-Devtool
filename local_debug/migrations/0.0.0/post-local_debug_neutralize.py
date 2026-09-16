# -*- coding: utf-8 -*-

from odoo import SUPERUSER_ID, api

from odoo.addons.local_debug import apply_local_debug_neutralization


def migrate(cr, version):
    env = api.Environment(cr, SUPERUSER_ID, {})
    apply_local_debug_neutralization(env)
