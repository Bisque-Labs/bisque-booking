"""Shared Jinja2 templates instance with auto current_user injection."""

from __future__ import annotations

from jinja2 import pass_context
from fastapi.templating import Jinja2Templates

_templates = None


class AutoUserTemplates(Jinja2Templates):
    """Override TemplateResponse to auto-inject current_user from request.state."""

    def TemplateResponse(self, name, context, *args, **kwargs):
        request = context.get("request")
        if request and "current_user" not in context:
            context["current_user"] = getattr(request.state, "current_user", None)
        return super().TemplateResponse(name, context, *args, **kwargs)


def get_templates() -> AutoUserTemplates:
    global _templates
    if _templates is None:
        _templates = AutoUserTemplates(directory="app/templates")
        _templates.env.globals["zip"] = zip
        _templates.env.globals["len"] = len
    return _templates
