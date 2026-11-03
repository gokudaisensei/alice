"""What the Alice app may write into Home Assistant, and nothing else.

The app can hold a key that is not an administrator's. With that key it may write scenes, scripts and automations whose ids start
with `alice_`, and only in shapes the app itself produces: no templates, a short list of services, no way to unlock a door, disarm
an alarm or open a garage. A leaked key can then do what the app can do, not what an administrator can.

This module imports nothing from Home Assistant so it can be tested on its own.
"""

from __future__ import annotations

import re
from typing import Any, Callable

ID_RE = re.compile(r"^alice_[a-z0-9_]{1,60}$")
ENTITY_RE = re.compile(r"^([a-z_]+)\.[a-z0-9_]{1,64}$")
TIME_RE = re.compile(r"^-?\d{1,2}:\d{2}(:\d{2})?$")
KINDS = ("scene", "script", "automation")
MAX_ITEMS = 40
MAX_DEPTH = 6

# domain -> services a stored routine or automation may call. Never: lock.unlock, alarm_control_panel.*, shell_command, anything with a template.
ACTIONS: dict[str, set[str]] = {
    "light": {"turn_on", "turn_off"}, "switch": {"turn_on", "turn_off"}, "fan": {"turn_on", "turn_off"}, "input_boolean": {"turn_on", "turn_off"},
    "climate": {"set_temperature", "set_hvac_mode"}, "lock": {"lock"},
    "media_player": {"media_play", "media_pause", "volume_set", "turn_on", "turn_off"},
    "cover": {"open_cover", "close_cover", "set_cover_position", "set_cover_tilt_position", "stop_cover"},
    "valve": {"open_valve", "close_valve", "set_valve_position"},
    "vacuum": {"start", "pause", "return_to_base", "locate", "set_fan_speed"},
    "humidifier": {"turn_on", "turn_off", "set_humidity", "set_mode"},
    "water_heater": {"turn_on", "turn_off", "set_temperature", "set_operation_mode"},
    "siren": {"turn_on", "turn_off"}, "number": {"set_value"}, "input_number": {"set_value"},
    "select": {"select_option"}, "input_select": {"select_option"}, "button": {"press"}, "input_button": {"press"},
    "scene": {"turn_on"},
}
# Things that let something in. Opening them is never stored, whatever the app asks.
SENSITIVE_CLASSES = {"cover": {"garage", "gate", "door"}, "valve": {"water", "gas"}}
OPENING = {"open_cover", "set_cover_position", "set_cover_tilt_position", "open_valve", "set_valve_position"}

TOP = {
    "scene": {"name", "entities", "icon"},
    "script": {"alias", "description", "mode", "sequence", "icon"},
    "automation": {"alias", "description", "mode", "max_exceeded", "triggers", "conditions", "actions"},
}
TRIGGERS = {
    "state": {"trigger", "entity_id", "from", "to", "for"}, "numeric_state": {"trigger", "entity_id", "above", "below", "for"},
    "time": {"trigger", "at"}, "sun": {"trigger", "event", "offset"},
}
CONDITIONS = {
    "state": {"condition", "entity_id", "state"}, "numeric_state": {"condition", "entity_id", "above", "below"},
    "time": {"condition", "after", "before", "weekday"}, "or": {"condition", "conditions"}, "not": {"condition", "conditions"},
}
SCENE_DOMAINS = {"light", "switch", "fan"}


class Invalid(ValueError):
    """The write was refused; the message says which part, without echoing the content."""


def _plain(v: Any, depth: int = 0) -> None:
    """Scalars, lists and dicts only, with no template syntax anywhere."""
    if depth > MAX_DEPTH:
        raise Invalid("too deeply nested")
    if isinstance(v, str):
        if "{{" in v or "{%" in v or "{#" in v or len(v) > 500:
            raise Invalid("templates and long text are not allowed")
    elif isinstance(v, (int, float, bool)) or v is None:
        return
    elif isinstance(v, list):
        if len(v) > MAX_ITEMS:
            raise Invalid("too many items")
        for x in v:
            _plain(x, depth + 1)
    elif isinstance(v, dict):
        if len(v) > MAX_ITEMS:
            raise Invalid("too many items")
        for k, x in v.items():
            if not isinstance(k, str):
                raise Invalid("keys must be text")
            _plain(k, depth + 1)
            _plain(x, depth + 1)
    else:
        raise Invalid("unsupported value")


def _entity_ids(v: Any, *, domain: str | None = None) -> list[str]:
    ids = v if isinstance(v, list) else [v]
    if not ids or len(ids) > MAX_ITEMS or not all(isinstance(i, str) and ENTITY_RE.match(i) for i in ids):
        raise Invalid("bad entity id")
    if domain and any(i.split(".")[0] != domain for i in ids):
        raise Invalid("target is not of the action's domain")
    return ids


def _action(step: Any, device_class: Callable[[str], str | None]) -> None:
    if not isinstance(step, dict):
        raise Invalid("a step must be an object")
    if set(step) == {"delay"}:
        d = step["delay"]
        if not (isinstance(d, dict) and set(d) == {"seconds"} and isinstance(d["seconds"], int) and not isinstance(d["seconds"], bool) and 1 <= d["seconds"] <= 600):
            raise Invalid("bad delay")
        return
    if not set(step) <= {"action", "target", "data"} or "action" not in step:
        raise Invalid("a step may only have action, target and data")
    name = step["action"]
    if not isinstance(name, str) or "." not in name:
        raise Invalid("bad action")
    domain, service = name.split(".", 1)
    if service not in ACTIONS.get(domain, set()):
        raise Invalid(f"{name} is not allowed")
    target = step.get("target")
    if not (isinstance(target, dict) and set(target) == {"entity_id"}):
        raise Invalid("a step needs target.entity_id")
    ids = _entity_ids(target["entity_id"], domain=domain)
    if "data" in step:
        if not isinstance(step["data"], dict):
            raise Invalid("data must be an object")
        _plain(step["data"])
    if domain in SENSITIVE_CLASSES and service in OPENING:
        for i in ids:
            if (device_class(i) or "") in SENSITIVE_CLASSES[domain]:
                raise Invalid("that would open something that guards the home")


def _trigger(t: Any) -> None:
    if not isinstance(t, dict) or t.get("trigger") not in TRIGGERS or not set(t) <= TRIGGERS[t["trigger"]]:
        raise Invalid("unsupported trigger")
    _plain(t)
    if "entity_id" in t:
        _entity_ids(t["entity_id"])
    if t["trigger"] == "time" and not (isinstance(t.get("at"), str) and TIME_RE.match(t["at"])):
        raise Invalid("bad time")
    if t["trigger"] == "sun" and (t.get("event") not in ("sunrise", "sunset") or not (isinstance(t.get("offset", "0:00"), str) and TIME_RE.match(t.get("offset", "0:00")))):
        raise Invalid("bad sun trigger")


def _condition(c: Any, depth: int = 0) -> None:
    if depth > 3 or not isinstance(c, dict) or c.get("condition") not in CONDITIONS or not set(c) <= CONDITIONS[c["condition"]]:
        raise Invalid("unsupported condition")
    if c["condition"] in ("or", "not"):
        inner = c.get("conditions")
        if not isinstance(inner, list) or not inner or len(inner) > MAX_ITEMS:
            raise Invalid("bad condition group")
        for x in inner:
            _condition(x, depth + 1)
        return
    _plain(c)
    if "entity_id" in c:
        _entity_ids(c["entity_id"])


def check(kind: str, ident: str, config: Any, device_class: Callable[[str], str | None] = lambda _i: None) -> None:
    """Raise `Invalid` unless this is something the app itself would write."""
    if kind not in KINDS:
        raise Invalid("unknown kind")
    if not isinstance(ident, str) or not ID_RE.match(ident):
        raise Invalid("ids must start with alice_")
    if not isinstance(config, dict) or not set(config) <= TOP[kind]:
        raise Invalid("unexpected keys")
    for key in ("alias", "name", "description", "icon", "mode", "max_exceeded"):
        if key in config and not isinstance(config[key], str):
            raise Invalid(f"{key} must be text")
    _plain({k: v for k, v in config.items() if k in ("alias", "name", "description", "icon", "mode", "max_exceeded")})
    if kind == "scene":
        ents = config.get("entities")
        if not isinstance(ents, dict) or not ents or len(ents) > MAX_ITEMS:
            raise Invalid("a scene needs entities")
        for eid, st in ents.items():
            if not ENTITY_RE.match(eid) or eid.split(".")[0] not in SCENE_DOMAINS or not isinstance(st, dict) or not isinstance(st.get("state"), str):
                raise Invalid("bad scene entity")
            _plain(st)
    elif kind == "script":
        seq = config.get("sequence")
        if not isinstance(seq, list) or not seq or len(seq) > 40:
            raise Invalid("a script needs steps")
        for s in seq:
            _action(s, device_class)
    else:
        for key in ("triggers", "actions"):
            if not isinstance(config.get(key), list) or not config[key] or len(config[key]) > 40:
                raise Invalid(f"an automation needs {key}")
        for t in config["triggers"]:
            _trigger(t)
        for c in config.get("conditions", []):
            _condition(c)
        for s in config["actions"]:
            _action(s, device_class)
